// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки
// Backend: Node.js + SQLite (доступен через Ngrok)
// Frontend: GitHub Pages

Ext.define('Store.passenger_transit.Module', {
    extend: 'Ext.Component',
    extensionName: 'passenger_transit',

    backendBaseUrl: 'https://saggy-return-aide.ngrok-free.dev',

    getBackendUrl: function(action) {
        return this.backendBaseUrl + '/api/' + action;
    },

    state: {
        currentPanel: 'routes',      // 'routes' | 'stops' | 'stop-edit'

        // Справочник остановок (независимая сущность)
        stopsCatalog: [],

        // RFID метки
        rfidTags: [],

        // Маршруты
        routes: [],
        selectedRoute: null,
        selectedVehicle: null,

        // Слои карты
        mapLayers: {
            routes: {},
            stopsCatalog: {},        // Маркеры-позиции остановок справочника
            routeStops: {},          // Остановки выбранного маршрута
            vehicles: {},
            tracks: {},
            editingPolyline: null,
            editingPoints: [],
            editingStopZone: null    // Геозона редактируемой остановки
        },

        // Режимы
        editMode: false,
        addStopMode: false,
        routeEditMode: false,
        editDirection: 'forward',

        // Редактируемая остановка (null = создание новой)
        editingStop: null,

        // PILOT данные
        pilotVehicles: [],
        isTabActive: false
    },

    getModuleBaseUrl: function () {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src || '';
            if (src.indexOf('Module.js') !== -1) {
                return src.substring(0, src.lastIndexOf('Module.js'));
            }
        }
        return '/store/passenger_transit/';
    },

    initModule: function () {
        var me = this;

        // ========================================================================
        // ОБХОД ПРЕДУПРЕЖДЕНИЯ NGROK (Free Tier)
        // ========================================================================
        Ext.Ajax.on('beforerequest', function(conn, options) {
            options.headers = options.headers || {};
            options.headers['ngrok-skip-browser-warning'] = 'true';
        });
        // ========================================================================

        // Load CSS
        var cssHref = me.getModuleBaseUrl() + 'style.css';
        if (!document.querySelector('link[href="' + cssHref + '"]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssHref;
            document.head.appendChild(link);
        }

        // ========================================================================
        // СОЗДАЕМ ПАНЕЛИ
        // ========================================================================

        // Дерево маршрутов (верхняя часть левой панели)
        me.routeTree = Ext.create('Store.passenger_transit.view.RouteTree', { module: me });

        // Грид ТС маршрута (нижняя часть левой панели)
        me.vehiclesGrid = Ext.create('Store.passenger_transit.view.RouteVehiclesGrid', { module: me });

        // Справочник остановок
        me.stopsCatalogPanel = Ext.create('Store.passenger_transit.view.StopsCatalogPanel', { module: me });

        // Панель редактирования остановки
        me.stopEditPanel = Ext.create('Store.passenger_transit.view.StopEditPanel', { module: me });

        // ========================================================================
        // КОНТЕЙНЕР ДЛЯ РЕЖИМА "МАРШРУТЫ": ДЕРЕВО + ГРИД ТС
        // ========================================================================
        me.routesContent = Ext.create('Ext.panel.Panel', {
            layout: 'border',
            border: false,
            bodyBorder: false,
            items: [
                {
                    region: 'center',
                    layout: 'fit',
                    border: false,
                    items: [me.routeTree]
                },
                {
                    region: 'south',
                    height: 220,
                    split: true,
                    collapsible: true,
                    collapseDirection: 'down',
                    title: l('ТС маршрута'),
                    titleCollapse: true,
                    layout: 'fit',
                    border: false,
                    items: [me.vehiclesGrid]
                }
            ]
        });

        // Card-контейнер для переключения между режимами
        me.leftContent = Ext.create('Ext.panel.Panel', {
            layout: 'card',
            border: false,
            bodyBorder: false,
            activeItem: 0,
            items: [me.routesContent, me.stopsCatalogPanel, me.stopEditPanel]
        });

        // Тулбар-переключатель
        me.panelSwitcher = Ext.create('Ext.toolbar.Toolbar', {
            dock: 'top',
            cls: 'pt-panel-switcher',
            items: [
                {
                    text: l('Маршруты'),
                    iconCls: 'fa fa-route',
                    enableToggle: true,
                    toggleGroup: 'panelSwitch',
                    pressed: true,
                    flex: 1,
                    handler: function() { me.switchPanel('routes'); }
                },
                {
                    text: l('Остановки'),
                    iconCls: 'fa fa-map-marker',
                    enableToggle: true,
                    toggleGroup: 'panelSwitch',
                    flex: 1,
                    handler: function() { me.switchPanel('stops'); }
                }
            ]
        });

        me.navContainer = Ext.create('Ext.panel.Panel', {
            layout: 'fit',
            border: false,
            dockedItems: [me.panelSwitcher],
            items: [me.leftContent]
        });

        // Navigation tab
        me.navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 420,
            layout: 'fit',
            items: [me.navContainer]
        });

        // ВАЖНО: НЕ устанавливаем map_frame, чтобы карта PILOT оставалась видимой
        me.navTab.map_frame = null;

        // Integrate with PILOT skeleton
        if (window.skeleton && skeleton.navigation && skeleton.mapframe) {
            skeleton.navigation.add(me.navTab);
            // НЕ добавляем MainPanel в mapframe - карта PILOT остается видимой

            // Add header button
            if (skeleton.header && skeleton.header.insert) {
                skeleton.header.insert(6, {
                    xtype: 'button',
                    cls: 'header_tool passenger_transit-header-btn',
                    iconCls: 'fa fa-route',
                    tooltip: l('Пассажирские перевозки'),
                    handler: function () {
                        skeleton.navigation.setActiveTab(me.navTab);
                    },
                    scope: me
                });
            }

            // Обработчик переключения вкладок
            if (skeleton.navigation.on) {
                skeleton.navigation.on('tabchange', function(tabPanel, newTab) {
                    if (newTab === me.navTab) me.onTabActivated();
                    else me.onTabDeactivated();
                });
            }

            // Load data
            me.loadStopsCatalog();
            me.loadRfidTags();
            me.loadRoutes();
            me.loadVehiclesFromPilot();

            // Создаем плавающие панели (мнемосхема и график) после инициализации
            setTimeout(function() {
                me.createFloatingPanels();
                if (skeleton.navigation.getActiveTab && skeleton.navigation.getActiveTab() === me.navTab) {
                    me.onTabActivated();
                }
            }, 500);
        } else {
            Ext.log('passenger_transit: skeleton not found');
        }
    },

    // ==================== ПЕРЕКЛЮЧЕНИЕ ПАНЕЛЕЙ ====================

    switchPanel: function(panelName) {
        var me = this;
        me.state.currentPanel = panelName;

        if (panelName === 'routes') {
            me.leftContent.getLayout().setActiveItem(0);
            me.exitAddStopMode();
        } else if (panelName === 'stops') {
            me.leftContent.getLayout().setActiveItem(1);
            me.exitAddStopMode();
        } else if (panelName === 'stop-edit') {
            me.leftContent.getLayout().setActiveItem(2);
        }
    },

    onTabActivated: function() {
        this.state.isTabActive = true;
        this.drawAllCatalogStops();
        this.showFloatingPanels();
    },

    onTabDeactivated: function() {
        this.state.isTabActive = false;
        this.clearAllCatalogStops();
        this.hideFloatingPanels();
    },

    // ==================== ПЛАВАЮЩИЕ ПАНЕЛИ (МНЕМОСХЕМА И ГРАФИК) ====================

    showFloatingPanels: function() {
        var me = this;
        if (me.memoWindow && !me.memoWindow.isVisible()) me.memoWindow.show();
        if (me.timelineWindow && !me.timelineWindow.isVisible()) me.timelineWindow.show();
    },

    hideFloatingPanels: function() {
        var me = this;
        if (me.memoWindow && me.memoWindow.isVisible()) me.memoWindow.hide();
        if (me.timelineWindow && me.timelineWindow.isVisible()) me.timelineWindow.hide();
    },

    createFloatingPanels: function() {
        var me = this;

        me.memoPanel = Ext.create('Store.passenger_transit.view.RouteMemoPanel', { module: me });
        me.memoWindow = Ext.create('Ext.window.Window', {
            title: l('Мнемосхема'),
            width: 320, height: 500,
            x: window.innerWidth - 340, y: 100,
            collapsible: true, collapseDirection: 'right',
            closeAction: 'hide', layout: 'fit',
            cls: 'pt-floating-memo-panel',
            items: [me.memoPanel],
            listeners: {
                beforeclose: function(win) { win.hide(); return false; }
            }
        });

        me.timelinePanel = Ext.create('Store.passenger_transit.view.TimelinePanel', { module: me });
        me.timelineWindow = Ext.create('Ext.window.Window', {
            title: l('График рейсов'),
            width: 600, height: 250,
            x: (window.innerWidth - 620) / 2, y: window.innerHeight - 270,
            collapsible: true, collapseDirection: 'down',
            closeAction: 'hide', layout: 'fit',
            cls: 'pt-floating-timeline-panel',
            items: [me.timelinePanel],
            listeners: {
                beforeclose: function(win) { win.hide(); return false; }
            }
        });
    },

    // ==================== PILOT API INTEGRATION ====================

    loadVehiclesFromPilot: function () {
        var me = this;
        Ext.Ajax.request({
            url: '/ax/tree.php',
            params: { vehs: 1, state: 1, lat: 1, lon: 1, dir: 1, speed: 1 },
            success: function (resp) {
                var groups = Ext.decode(resp.responseText);
                me.state.pilotVehicles = me.parsePilotTree(groups);
            },
            failure: function () {
                Ext.log('passenger_transit: failed to load vehicles from PILOT');
            }
        });
    },

    parsePilotTree: function (groups) {
        var vehicles = [];
        if (!Ext.isArray(groups)) return vehicles;
        function walk(items, parentGroup) {
            Ext.each(items, function (item) {
                if (item.children && Ext.isArray(item.children)) {
                    walk(item.children, item.name);
                } else if (item.id && item.name) {
                    vehicles.push({
                        id: item.id, name: item.name,
                        number: item.number || item.name,
                        group: parentGroup || '',
                        lat: item.lat || 0, lon: item.lon || item.lng || 0,
                        dir: item.dir || 0, speed: item.speed || 0,
                        online: item.state === 1
                    });
                }
            });
        }
        walk(groups);
        return vehicles;
    },

    // ==================== RFID МЕТКИ ====================

    loadRfidTags: function () {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('rfid-tags'),
            method: 'GET',
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) me.state.rfidTags = data.tags || [];
            },
            failure: function () { Ext.log('passenger_transit: failed to load RFID tags'); }
        });
    },

    // ==================== СПРАВОЧНИК ОСТАНОВОК ====================

    loadStopsCatalog: function () {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('stops-catalog'),
            method: 'GET',
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    me.state.stopsCatalog = data.stops || [];
                    me.refreshStopsCatalogPanel();
                    if (me.state.isTabActive) me.drawAllCatalogStops();
                }
            },
            failure: function () { Ext.log('passenger_transit: failed to load stops catalog'); }
        });
    },

    createStopInCatalog: function(stopData) {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('stops-catalog'),
            method: 'POST',
            jsonData: stopData,
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    Ext.toast({ html: l('Остановка добавлена'), align: 't', timeout: 2500 });
                    me.loadStopsCatalog();
                    me.switchPanel('stops');
                } else {
                    Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось добавить'));
                }
            },
            failure: function () { Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения')); }
        });
    },

    updateStopInCatalog: function(stopId, updates) {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('stops-catalog/' + stopId),
            method: 'PUT',
            jsonData: updates,
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    Ext.toast({ html: l('Остановка обновлена'), align: 't', timeout: 2000 });
                    me.loadStopsCatalog();
                    me.switchPanel('stops');
                } else {
                    Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось обновить'));
                }
            },
            failure: function () { Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения')); }
        });
    },

    deleteStopFromCatalog: function(stopId) {
        var me = this;
        Ext.Msg.confirm(
            l('Удаление остановки'),
            l('Вы уверены, что хотите удалить остановку?'),
            function (btn) {
                if (btn === 'yes') {
                    Ext.Ajax.request({
                        url: me.getBackendUrl('stops-catalog/' + stopId),
                        method: 'DELETE',
                        success: function (resp) {
                            var data = Ext.decode(resp.responseText);
                            if (data.success) {
                                Ext.toast({ html: l('Остановка удалена'), align: 't', timeout: 2000 });
                                me.loadStopsCatalog();
                            } else {
                                Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось удалить'));
                            }
                        }
                    });
                }
            }
        );
    },

    // ========================================================================
    // ОТОБРАЖЕНИЕ ОСТАНОВОК НА КАРТЕ (МАРКЕРЫ-ПОЗИЦИИ)
    // ========================================================================

    drawAllCatalogStops: function() {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me.clearAllCatalogStops();
        me.state.stopsCatalog.forEach(function(stop) {
            me.drawCatalogStop(stop);
        });
    },

    /**
     * Рисует остановку как МАРКЕР-ПОЗИЦИЮ (pin).
     * При клике — карта центрируется на остановке.
     */
    drawCatalogStop: function(stop) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        var icon = L.divIcon({
            className: 'pt-catalog-stop-pin',
            html: '<div class="pt-catalog-stop-pin-inner" title="' + Ext.String.htmlEncode(stop.name) + '">' +
                  '<i class="fa fa-map-marker"></i>' +
                  '</div>',
            iconSize: [30, 42],
            iconAnchor: [15, 42],
            popupAnchor: [0, -42]
        });

        var marker = L.marker([stop.lat, stop.lon], {
            icon: icon,
            title: stop.name,
            zIndexOffset: 100
        }).addTo(map.map);

        // Popup с информацией
        var popupHtml = '<div class="pt-stop-popup">' +
            '<b>' + Ext.String.htmlEncode(stop.name) + '</b>';
        if (stop.identifier) {
            popupHtml += '<br/><small><b>' + l('ID') + ':</b> ' + Ext.String.htmlEncode(stop.identifier) + '</small>';
        }
        popupHtml += '<br/><small>' + l('Радиус') + ': ' + (stop.radius || 30) + ' м</small>' +
            '<br/><small>' + stop.lat.toFixed(6) + ', ' + stop.lon.toFixed(6) + '</small>';
        if (stop.rfid_code) {
            popupHtml += '<br/><small><i class="fa fa-microchip"></i> RFID: <b>' + Ext.String.htmlEncode(stop.rfid_code) + '</b></small>';
        }
        popupHtml += '</div>';
        marker.bindPopup(popupHtml);

        // КЛИК ПО МАРКЕРУ — центрируем карту на остановке
        marker.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            map.map.setView([stop.lat, stop.lon], 17, { animate: true });
        });

        me.state.mapLayers.stopsCatalog[stop.id] = {
            marker: marker,
            data: stop
        };
    },

    clearAllCatalogStops: function() {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        Object.keys(me.state.mapLayers.stopsCatalog).forEach(function(key) {
            var layer = me.state.mapLayers.stopsCatalog[key];
            if (layer.marker) map.map.removeLayer(layer.marker);
        });
        me.state.mapLayers.stopsCatalog = {};
    },

    removeCatalogStopMarker: function(stopId) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;
        var layer = me.state.mapLayers.stopsCatalog[stopId];
        if (layer && layer.marker) {
            map.map.removeLayer(layer.marker);
            delete me.state.mapLayers.stopsCatalog[stopId];
        }
    },

    restoreCatalogStopMarker: function(stop) {
        var me = this;
        if (!me.state.mapLayers.stopsCatalog[stop.id]) {
            me.drawCatalogStop(stop);
        }
    },

    refreshStopsCatalogPanel: function() {
        if (this.stopsCatalogPanel) {
            this.stopsCatalogPanel.loadStops(this.state.stopsCatalog);
        }
    },

    // ========================================================================
    // РЕЖИМ ДОБАВЛЕНИЯ НОВОЙ ОСТАНОВКИ
    // ========================================================================

    enterAddStopMode: function() {
        var me = this;
        if (me.state.addStopMode) return;

        me.state.addStopMode = true;
        me.state.editingStop = null;

        me.switchPanel('stop-edit');
        me.stopEditPanel.resetForm();
        me.stopEditPanel.setMode('create');

        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me._addStopClickHandler = function(e) {
            if (!me.state.addStopMode) return;
            me.stopEditPanel.setCoords(e.latlng.lat, e.latlng.lng);

            if (!me.state.mapLayers.editingStopZone) {
                me._createEditingZone(e.latlng.lat, e.latlng.lng, 30);
            } else {
                me.state.mapLayers.editingStopZone.circle.setLatLng([e.latlng.lat, e.latlng.lng]);
                me._updateEditingZoneMarkers();
            }
        };

        map.map.on('click', me._addStopClickHandler);
        map.map.getContainer().style.cursor = 'crosshair';

        Ext.toast({
            html: l('Кликните по карте для указания координат остановки'),
            align: 't',
            timeout: 5000
        });
    },

    // ========================================================================
    // РЕДАКТИРОВАНИЕ СУЩЕСТВУЮЩЕЙ ОСТАНОВКИ
    // При нажатии "Редактировать" — маркер заменяется на геозону
    // ========================================================================

    editCatalogStop: function(stop) {
        var me = this;
        me.state.editingStop = stop;
        me.exitAddStopMode();

        // Удаляем маркер с карты
        me.removeCatalogStopMarker(stop.id);

        // Переключаемся на панель редактирования
        me.switchPanel('stop-edit');
        me.stopEditPanel.setMode('edit');
        me.stopEditPanel.loadStopData(stop);

        // Создаём геозону для редактирования
        me._createEditingZone(stop.lat, stop.lon, stop.radius || 30);

        // Центрируем карту на остановке
        var map = me.getPilotMap();
        if (map && map.map) {
            map.map.setView([stop.lat, stop.lon], 17, { animate: true });
        }
    },

    /**
     * Центрирует карту на остановке (без редактирования)
     */
    focusOnStop: function(stop) {
        var map = this.getPilotMap();
        if (map && map.map) {
            map.map.setView([stop.lat, stop.lon], 17, { animate: true });
        }
    },

    exitAddStopMode: function() {
        var me = this;
        me.state.addStopMode = false;
        var map = me.getPilotMap();
        if (map && map.map) {
            if (me._addStopClickHandler) {
                map.map.off('click', me._addStopClickHandler);
            }
            map.map.getContainer().style.cursor = '';
        }
        me.removeEditingStopZone();
    },

    _createEditingZone: function(lat, lon, radius) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me.removeEditingStopZone();

        var previewCircle = L.circle([lat, lon], {
            radius: radius,
            color: '#f59e0b',
            fillColor: '#fef3c7',
            fillOpacity: 0.4,
            weight: 2,
            dashArray: '5, 5'
        }).addTo(map.map);

        var centerMarker = L.marker([lat, lon], {
            draggable: true,
            icon: L.divIcon({
                className: 'pt-stop-edit-center',
                html: '<div class="pt-stop-edit-center-inner"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map.map);

        var radiusMarker = L.marker([lat, lon], {
            draggable: true,
            icon: L.divIcon({
                className: 'pt-stop-edit-radius',
                html: '<div class="pt-stop-edit-radius-inner"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        }).addTo(map.map);

        function updateRadiusMarkerPosition() {
            var c = previewCircle.getLatLng();
            var r = previewCircle.getRadius();
            var offset = r / 111000;
            radiusMarker.setLatLng([c.lat, c.lng + offset]);
        }
        updateRadiusMarkerPosition();

        centerMarker.on('drag', function(e) {
            var ll = e.target.getLatLng();
            previewCircle.setLatLng(ll);
            updateRadiusMarkerPosition();
            me.stopEditPanel.setCoords(ll.lat, ll.lng);
        });

        radiusMarker.on('drag', function(e) {
            var center = previewCircle.getLatLng();
            var edge = e.target.getLatLng();
            var distance = center.distanceTo(edge);
            previewCircle.setRadius(Math.max(5, distance));
            me.stopEditPanel.setRadius(Math.round(previewCircle.getRadius()));
        });

        me.state.mapLayers.editingStopZone = {
            circle: previewCircle,
            centerMarker: centerMarker,
            radiusMarker: radiusMarker,
            updateRadiusMarkerPosition: updateRadiusMarkerPosition
        };
    },

    _updateEditingZoneMarkers: function() {
        var zone = this.state.mapLayers.editingStopZone;
        if (zone && zone.updateRadiusMarkerPosition) {
            zone.updateRadiusMarkerPosition();
        }
    },

    removeEditingStopZone: function() {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;
        var zone = me.state.mapLayers.editingStopZone;
        if (zone) {
            if (zone.circle) map.map.removeLayer(zone.circle);
            if (zone.centerMarker) map.map.removeLayer(zone.centerMarker);
            if (zone.radiusMarker) map.map.removeLayer(zone.radiusMarker);
            me.state.mapLayers.editingStopZone = null;
        }
    },

    saveStopFromPanel: function(data) {
        var me = this;
        var zone = me.state.mapLayers.editingStopZone;

        var lat = zone ? zone.circle.getLatLng().lat : data.lat;
        var lon = zone ? zone.circle.getLatLng().lng : data.lon;
        var radius = zone ? Math.round(zone.circle.getRadius()) : data.radius;

        var stopData = {
            name: data.name,
            identifier: data.identifier || null,
            description: data.description || null,
            lat: lat,
            lon: lon,
            radius: radius,
            rfid_tag_id: data.rfid_tag_id || null
        };

        if (me.state.editingStop) {
            me.updateStopInCatalog(me.state.editingStop.id, stopData);
        } else {
            me.createStopInCatalog(stopData);
        }

        me.state.editingStop = null;
        me.exitAddStopMode();
    },

    cancelStopEdit: function() {
        var me = this;
        var editingStop = me.state.editingStop;
        me.state.editingStop = null;
        me.exitAddStopMode();

        // Если редактировали существующую остановку — восстанавливаем её маркер
        if (editingStop) {
            me.restoreCatalogStopMarker(editingStop);
        }

        me.switchPanel('stops');
    },

    // ==================== RFID SELECT ====================

    showRfidSelectWindow: function(currentTagId, callback) {
        var me = this;

        Ext.Ajax.request({
            url: me.getBackendUrl('rfid-tags'),
            method: 'GET',
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) me.state.rfidTags = data.tags || [];

                var win = Ext.create('Store.passenger_transit.view.RfidSelectWindow', {
                    module: me,
                    currentTagId: currentTagId,
                    listeners: {
                        select: function(w, tag) { if (callback) callback(tag); },
                        clear: function() { if (callback) callback(null); },
                        createTag: function(w, tagData) {
                            Ext.Ajax.request({
                                url: me.getBackendUrl('rfid-tags'),
                                method: 'POST',
                                jsonData: tagData,
                                success: function (resp) {
                                    var data = Ext.decode(resp.responseText);
                                    if (data.success) {
                                        Ext.toast({ html: l('RFID метка создана'), align: 't', timeout: 2000 });
                                        me.loadRfidTags();
                                        w.refreshTags();
                                    } else {
                                        Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось создать'));
                                    }
                                }
                            });
                        }
                    }
                });
                win.show();
            }
        });
    },

    // ==================== МАРШРУТЫ ====================

    loadRoutes: function () {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('routes'),
            method: 'GET',
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    me.state.routes = data.routes || [];
                    me.refreshRouteTree();
                }
            },
            failure: function () { Ext.log('passenger_transit: failed to load routes'); }
        });
    },

    getRouteById: function (routeId) {
        var found = null;
        Ext.each(this.state.routes, function (r) {
            if (r.id == routeId) { found = r; return false; }
        });
        return found;
    },

    refreshRouteTree: function () {
        if (this.routeTree) this.routeTree.loadRoutes(this.state.routes);
    },

    selectRoute: function (routeId) {
        var me = this;
        me.state.selectedRoute = routeId;
        var route = me.getRouteById(routeId);
        if (!route) return;

        me.clearRouteLayers(routeId);
        me.drawRoute(routeId, route.forward_points, route.backward_points);

        if (route.stops && route.stops.length > 0) {
            me.drawRouteStops(routeId, route.stops);
        }

        // Обновляем мнемосхему и график
        if (me.memoPanel) me.memoPanel.loadRoute(route);
        if (me.timelinePanel) me.timelinePanel.renderChart(me.getTimeline(routeId));

        // Обновляем грид ТС
        me.updateRouteVehiclesGrid(routeId);
    },

    drawRouteStops: function(routeId, stops) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        stops.forEach(function(stop, index) {
            var color = stop.direction === 'forward' ? '#2563eb' : '#dc2626';
            var circle = L.circle([stop.lat, stop.lon], {
                radius: stop.radius || 30,
                color: color, fillColor: color, fillOpacity: 0.25, weight: 3
            }).addTo(map.map);

            var label = L.marker([stop.lat, stop.lon], {
                icon: L.divIcon({
                    className: 'pt-route-stop-label',
                    html: '<div class="pt-route-stop-label-inner" style="background:' + color + '">' +
                          (index + 1) + '</div>',
                    iconSize: [24, 24], iconAnchor: [12, 12]
                })
            }).addTo(map.map);

            if (!me.state.mapLayers.routeStops[routeId]) me.state.mapLayers.routeStops[routeId] = [];
            me.state.mapLayers.routeStops[routeId].push({ circle: circle, label: label });
        });
    },

    drawRoute: function (routeId, forwardPoints, backwardPoints) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        this.clearRoutePolylines(routeId);

        if (forwardPoints && forwardPoints.length > 1) {
            var latlngs = forwardPoints.map(function (p) { return [p.lat, p.lon || p.lng]; });
            var line = L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(map.map);
            this.state.mapLayers.routes[routeId + '_forward'] = line;
        }
        if (backwardPoints && backwardPoints.length > 1) {
            var latlngs = backwardPoints.map(function (p) { return [p.lat, p.lon || p.lng]; });
            var line = L.polyline(latlngs, { color: '#dc2626', weight: 4, opacity: 0.85, dashArray: '8, 6' }).addTo(map.map);
            this.state.mapLayers.routes[routeId + '_backward'] = line;
        }
    },

    clearRouteLayers: function(routeId) {
        this.clearRoutePolylines(routeId);
        this.clearRouteStops(routeId);
    },

    clearRoutePolylines: function(routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        ['forward', 'backward'].forEach(function (dir) {
            var key = routeId + '_' + dir;
            if (this.state.mapLayers.routes[key]) {
                map.map.removeLayer(this.state.mapLayers.routes[key]);
                delete this.state.mapLayers.routes[key];
            }
        }.bind(this));
    },

    clearRouteStops: function(routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        if (this.state.mapLayers.routeStops[routeId]) {
            this.state.mapLayers.routeStops[routeId].forEach(function(item) {
                if (item.circle) map.map.removeLayer(item.circle);
                if (item.label) map.map.removeLayer(item.label);
            });
            delete this.state.mapLayers.routeStops[routeId];
        }
    },

    // ==================== ТС ====================

    getRouteVehicles: function (routeId) {
        var me = this;
        var vehicles = [];
        Ext.Ajax.request({
            url: me.getBackendUrl('vehicles/' + routeId),
            method: 'GET',
            async: false,
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) vehicles = data.vehicles || [];
            }
        });
        return vehicles;
    },

    bindVehicle: function (routeId, vehicleId, vehicleNumber) {
        Ext.Ajax.request({
            url: this.getBackendUrl('vehicles'),
            method: 'POST',
            jsonData: { route_id: routeId, vehicle_id: vehicleId, vehicle_number: vehicleNumber },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) Ext.toast({ html: l('ТС привязано'), align: 'br', timeout: 2000 });
            }
        });
    },

    unbindVehicle: function (routeId, vehicleId) {
        Ext.Ajax.request({
            url: this.getBackendUrl('vehicles'),
            method: 'DELETE',
            jsonData: { route_id: routeId, vehicle_id: vehicleId }
        });
    },

    getVehicleTrack: function (vehicleId, routeId) {
        var me = this;
        var trackPoints = [];
        var tripsCount = 0;
        Ext.Ajax.request({
            url: me.getBackendUrl('trips/track'),
            method: 'GET',
            params: { vehicle_id: vehicleId, route_id: routeId },
            async: false,
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    trackPoints = data.track || [];
                    tripsCount = data.trips_count || 0;
                }
            }
        });
        return { track: trackPoints, trips_count: tripsCount };
    },

    getTimeline: function (routeId) {
        var me = this;
        var timeline = { hours: [], trips: [] };
        Ext.Ajax.request({
            url: me.getBackendUrl('trips/timeline'),
            method: 'GET',
            params: { route_id: routeId },
            async: false,
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) timeline = data.timeline || { hours: [], trips: [] };
            }
        });
        return timeline;
    },

    updateRouteVehiclesGrid: function(routeId) {
        var me = this;
        if (!me.vehiclesGrid) return;
        me.vehiclesGrid.getStore().removeAll();
        if (!routeId) return;

        var boundVehicles = me.getRouteVehicles(routeId);
        if (!boundVehicles || boundVehicles.length === 0) return;

        var gridData = [];
        Ext.each(boundVehicles, function(v) {
            var trackInfo = me.getVehicleTrack(v.vehicle_id, routeId);
            var pilotVeh = me.state.pilotVehicles.find(function(pv) { return pv.id === v.vehicle_id; });

            var direction = 'forward';
            if (trackInfo.track && trackInfo.track.length > 1) {
                var lastPoint = trackInfo.track[trackInfo.track.length - 1];
                if (lastPoint.direction) direction = lastPoint.direction;
            }

            gridData.push({
                vehicle_id: v.vehicle_id,
                vehicle_number: v.vehicle_number || (pilotVeh ? pilotVeh.number : 'N/A'),
                direction: direction,
                trips_count: trackInfo.trips_count || 0,
                online: pilotVeh ? pilotVeh.online : false,
                lat: pilotVeh ? pilotVeh.lat : 0,
                lon: pilotVeh ? pilotVeh.lon : 0
            });
        });

        me.vehiclesGrid.getStore().loadData(gridData);
    },

    selectVehicle: function (vehicleId, routeId) {
        var me = this;
        me.state.selectedVehicle = vehicleId;
        var trackInfo = me.getVehicleTrack(vehicleId, routeId);
        var map = me.getPilotMap();
        if (map && map.map && trackInfo.track.length > 0) {
            var bounds = L.latLngBounds(trackInfo.track.map(function(p) { return [p.lat, p.lon]; }));
            map.map.fitBounds(bounds, { padding: [50, 50] });
        }
        Ext.Msg.alert(
            l('ТС') + ' ' + vehicleId,
            l('Выполнено рейсов') + ': <b>' + (trackInfo.trips_count || 0) + '</b>'
        );
    },

    showVehicleBindingDialog: function (routeId) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route) return;
        var boundVehicles = me.getRouteVehicles(routeId);
        me.createVehicleBindingWindow(route, boundVehicles);
    },

    createVehicleBindingWindow: function (route, boundVehicles) {
        var me = this;
        var pilotStore = Ext.create('Ext.data.Store', {
            fields: ['id', 'name', 'number', 'group', 'online'],
            data: me.state.pilotVehicles,
            filters: [function (item) {
                return !boundVehicles.some(function (bv) { return bv.vehicle_id === item.data.id; });
            }]
        });

        var boundStore = Ext.create('Ext.data.Store', {
            fields: ['id', 'vehicle_id', 'vehicle_number'],
            data: boundVehicles.map(function (v) {
                return { id: v.id, vehicle_id: v.vehicle_id, vehicle_number: v.vehicle_number };
            })
        });

        var win = Ext.create('Ext.window.Window', {
            title: l('Привязка ТС к маршруту') + ' - ' + route.name,
            width: 800, height: 500, layout: 'border', modal: true,
            cls: 'pt-vehicle-dialog',
            items: [
                {
                    region: 'west', title: l('Доступные ТС (из PILOT)'), width: 380, split: true, layout: 'fit',
                    items: [{
                        xtype: 'grid', store: pilotStore,
                        columns: [
                            {
                                text: l('ТС'), dataIndex: 'number', flex: 1,
                                renderer: function (v, m, r) {
                                    var online = r.get('online');
                                    m.tdAttr = 'style="background-color:' + (online ? '#dcfce7' : '#fee2e2') + '"';
                                    return v + (online ? ' <span style="color:green">●</span>' : ' <span style="color:red">●</span>');
                                }
                            },
                            { text: l('Группа'), dataIndex: 'group', width: 150 }
                        ],
                        selModel: { selType: 'checkboxmodel' }
                    }]
                },
                {
                    region: 'center', title: l('Привязанные к маршруту'), layout: 'fit',
                    items: [{
                        xtype: 'grid', store: boundStore,
                        columns: [
                            { text: l('ТС'), dataIndex: 'vehicle_number', flex: 1 },
                            { text: l('ID'), dataIndex: 'vehicle_id', width: 100 }
                        ],
                        tbar: [{
                            text: l('Удалить'), iconCls: 'fa fa-trash',
                            handler: function () {
                                var grid = this.up('grid');
                                var sel = grid.getSelectionModel().getSelection();
                                if (sel.length > 0) {
                                    Ext.each(sel, function (r) { me.unbindVehicle(route.id, r.get('vehicle_id')); });
                                    boundStore.remove(sel);
                                }
                            }
                        }]
                    }]
                }
            ],
            buttons: [
                {
                    text: l('Привязать выбранные'), iconCls: 'fa fa-link',
                    handler: function () {
                        var leftGrid = win.down('region[region=west] grid');
                        var sel = leftGrid.getSelectionModel().getSelection();
                        if (sel.length === 0) {
                            Ext.Msg.alert(l('Внимание'), l('Выберите хотя бы одно ТС'));
                            return;
                        }
                        Ext.each(sel, function (r) { me.bindVehicle(route.id, r.get('id'), r.get('number')); });
                        setTimeout(function() {
                            boundStore.reload();
                            pilotStore.reload();
                            leftGrid.getSelectionModel().deselectAll();
                            if (me.state.selectedRoute) me.updateRouteVehiclesGrid(me.state.selectedRoute);
                        }, 500);
                    }
                },
                { text: l('Закрыть'), handler: function () { win.close(); } }
            ]
        });
        win.show();
    },

    // ==================== ROUTE EDITOR ====================

    enableRouteEditMode: function (routeId, direction) {
        var me = this;
        me.state.routeEditMode = true;
        me.state.selectedRoute = routeId;
        me.state.editType = 'route';
        me.state.editingRoutePoints = { forward: [], backward: [] };

        var route = me.getRouteById(routeId);
        if (route) {
            if (direction === 'forward' && route.forward_points) {
                me.state.editingRoutePoints.forward = Ext.Array.clone(route.forward_points);
            } else if (direction === 'backward' && route.backward_points) {
                me.state.editingRoutePoints.backward = Ext.Array.clone(route.backward_points);
            }
        }

        var map = me.getPilotMap();
        if (!map || !map.map) {
            Ext.toast({ html: l('Карта недоступна'), align: 't', timeout: 3000 });
            return;
        }

        me._routeEditClickHandler = function (e) {
            if (!me.state.routeEditMode) return;
            var point = {
                lat: e.latlng.lat, lon: e.latlng.lng,
                order_index: me.state.editingRoutePoints[me.state.editDirection || 'forward'].length
            };
            me.state.editingRoutePoints[me.state.editDirection || 'forward'].push(point);
            me.drawEditingPolyline();
            me.updateEditToolbarStats();
            Ext.toast({
                html: l('Добавлена точка') + ' #' + point.order_index,
                align: 'br', timeout: 2000
            });
        };

        me._routeEditRightClickHandler = function (e) {
            if (!me.state.routeEditMode) return;
            if (e.originalEvent) e.originalEvent.preventDefault();
            me.finishRouteEditing();
        };

        map.map.on('click', me._routeEditClickHandler);
        map.map.on('contextmenu', me._routeEditRightClickHandler);
        me.state.editDirection = direction || 'forward';
        me.showRouteEditToolbar();
        Ext.toast({
            html: l('Режим рисования: кликайте для добавления точек. Правый клик - завершить.'),
            align: 't', timeout: 8000
        });
    },

    drawEditingPolyline: function () {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        if (me.state.mapLayers.editingPolyline) map.map.removeLayer(me.state.mapLayers.editingPolyline);
        if (me.state.mapLayers.editingPoints && me.state.mapLayers.editingPoints.length > 0) {
            me.state.mapLayers.editingPoints.forEach(function (m) { map.map.removeLayer(m); });
            me.state.mapLayers.editingPoints = [];
        }

        var direction = me.state.editDirection || 'forward';
        var points = me.state.editingRoutePoints[direction];
        if (points.length === 0) return;

        var latlngs = points.map(function (p) { return [p.lat, p.lon || p.lng]; });
        var color = direction === 'forward' ? '#2563eb' : '#dc2626';
        var dashArray = direction === 'forward' ? null : '8, 6';

        var polyline = L.polyline(latlngs, {
            color: color, weight: 5, opacity: 0.9, dashArray: dashArray
        }).addTo(map.map);
        me.state.mapLayers.editingPolyline = polyline;

        points.forEach(function (p, index) {
            var marker = L.circleMarker([p.lat, p.lon], {
                radius: 6, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9
            }).addTo(map.map);
            marker.bindPopup(l('Точка') + ' #' + (index + 1));
            me.state.mapLayers.editingPoints.push(marker);
        });
    },

    finishRouteEditing: function () {
        var me = this;
        if (!me.state.routeEditMode) return;
        var routeId = me.state.selectedRoute;
        if (!routeId) return;

        var points = me.state.editingRoutePoints[me.state.editDirection || 'forward'];
        if (points.length < 2) {
            Ext.Msg.alert(l('Ошибка'), l('Маршрут должен содержать минимум 2 точки'));
            return;
        }

        Ext.Msg.confirm(
            l('Сохранение маршрута'),
            l('Добавлено точек: ') + points.length + '. ' + l('Сохранить?'),
            function (btn) {
                if (btn === 'yes') me.saveRoutePoints(routeId, points, me.state.editDirection || 'forward');
                me.disableRouteEditMode();
            }
        );
    },

    disableRouteEditMode: function () {
        var me = this;
        me.state.routeEditMode = false;
        var map = me.getPilotMap();
        if (map && map.map) {
            if (me._routeEditClickHandler) map.map.off('click', me._routeEditClickHandler);
            if (me._routeEditRightClickHandler) map.map.off('contextmenu', me._routeEditRightClickHandler);
        }
        if (me.state.mapLayers.editingPolyline && map && map.map) {
            map.map.removeLayer(me.state.mapLayers.editingPolyline);
            me.state.mapLayers.editingPolyline = null;
        }
        if (me.state.mapLayers.editingPoints && map && map.map) {
            me.state.mapLayers.editingPoints.forEach(function (m) { map.map.removeLayer(m); });
            me.state.mapLayers.editingPoints = [];
        }
        me.hideRouteEditToolbar();
    },

    showRouteEditToolbar: function () {
        var me = this;
        if (!me.editToolbar) {
            me.editToolbar = Ext.create('Ext.toolbar.Toolbar', {
                cls: 'pt-edit-toolbar',
                floating: true, x: 100, y: 100,
                items: [
                    { text: l('Завершить'), iconCls: 'fa fa-check', handler: me.finishRouteEditing, scope: me },
                    { text: l('Отмена'), iconCls: 'fa fa-times', handler: me.disableRouteEditMode, scope: me },
                    '-',
                    {
                        text: l('Удалить последнюю'), iconCls: 'fa fa-undo',
                        handler: function () {
                            var dir = me.state.editDirection || 'forward';
                            me.state.editingRoutePoints[dir].pop();
                            me.drawEditingPolyline();
                            me.updateEditToolbarStats();
                        },
                        scope: me
                    },
                    { xtype: 'tbtext', text: l('Точек: ') + '0' }
                ]
            });
        }
        me.editToolbar.show();
        me.updateEditToolbarStats();
    },

    hideRouteEditToolbar: function () {
        if (this.editToolbar) this.editToolbar.hide();
    },

    updateEditToolbarStats: function () {
        var me = this;
        if (!me.editToolbar) return;
        var dir = me.state.editDirection || 'forward';
        var count = me.state.editingRoutePoints[dir].length;
        var textItem = me.editToolbar.down('tbtext');
        if (textItem) textItem.setText(l('Точек: ') + count);
    },

    saveRoutePoints: function (routeId, points, direction) {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('route-points'),
            method: 'POST',
            jsonData: { route_id: routeId, direction: direction, points: points },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    Ext.toast({ html: l('Маршрут сохранен'), align: 't', timeout: 3000 });
                    me.loadRoutes();
                } else {
                    Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось сохранить'));
                }
            },
            failure: function () {
                Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения с бэкендом'));
            }
        });
    },

    getPilotMap: function () {
        if (window.getActiveTabMapContainer) return getActiveTabMapContainer();
        return window.mapContainer || null;
    }
});


// ============================================================================
// VIEW: RouteTree (ВЕРХНЯЯ ЧАСТЬ ЛЕВОЙ ПАНЕЛИ)
// ============================================================================
Ext.define('Store.passenger_transit.view.RouteTree', {
    extend: 'Ext.tree.Panel',
    rootVisible: false,
    useArrows: true,
    cls: 'pt-route-tree',
    title: l('Маршруты'),
    iconCls: 'fa fa-route',

    initComponent: function () {
        var me = this;
        me.store = Ext.create('Ext.data.TreeStore', {
            root: { expanded: true, children: [] }
        });

        me.tbar = [
            { text: l('Добавить'), iconCls: 'fa fa-plus', handler: me.onAddRoute, scope: me, tooltip: l('Создать маршрут') },
            { text: l('Трасса'), iconCls: 'fa fa-pencil', handler: function() {
                var rec = me.getSelectionModel().getSelection()[0];
                if (rec && me.module) me.module.enableRouteEditMode(rec.data.route_id, 'forward');
                else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
            }, scope: me, tooltip: l('Нарисовать линию маршрута') },
            '-',
            { text: l('ТС'), iconCls: 'fa fa-link', handler: function() {
                var rec = me.getSelectionModel().getSelection()[0];
                if (rec && me.module) me.module.showVehicleBindingDialog(rec.data.route_id);
                else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
            }, scope: me, tooltip: l('Привязать ТС') }
        ];

        me.columns = [
            { xtype: 'treecolumn', text: l('Маршрут'), dataIndex: 'name', flex: 1 },
            { text: l('Ост.'), dataIndex: 'stop_count', width: 45, align: 'center' },
            { text: l('ТС'), dataIndex: 'vehicle_count', width: 45, align: 'center' }
        ];

        me.listeners = { itemclick: me.onRouteClick, scope: me };
        me.callParent(arguments);
    },

    loadRoutes: function (routes) {
        var me = this;
        var children = routes.map(function (r) {
            return {
                text: r.name, name: r.name,
                vehicle_count: r.vehicle_count || 0,
                stop_count: r.stop_count || 0,
                route_id: r.id, leaf: true,
                iconCls: 'fa fa-route'
            };
        });
        me.getRootNode().removeAll();
        me.getRootNode().appendChild(children);
    },

    onRouteClick: function (view, record) {
        if (this.module && record.data.route_id) {
            this.module.selectRoute(record.data.route_id);
        }
    },

    onAddRoute: function () {
        var me = this;
        Ext.Msg.prompt(
            l('Новый маршрут'),
            l('Название маршрута') + ':',
            function (btn, text) {
                if (btn === 'ok') {
                    var routeName = text ? String(text).trim() : '';
                    if (routeName.length < 2) {
                        Ext.Msg.alert(l('Ошибка'), l('Название должно содержать минимум 2 символа'));
                        return;
                    }
                    Ext.Ajax.request({
                        url: me.module.getBackendUrl('routes'),
                        method: 'POST',
                        jsonData: { name: routeName },
                        success: function (resp) {
                            var data = Ext.decode(resp.responseText);
                            if (data.success) {
                                Ext.toast({ html: l('Маршрут создан'), align: 't', timeout: 2000 });
                                me.module.loadRoutes();
                            } else {
                                Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось создать'));
                            }
                        },
                        failure: function (resp) {
                            Ext.Msg.alert(l('Ошибка'), l('Код ошибки: ') + resp.status);
                        }
                    });
                }
            },
            this, false, ''
        );
    }
});


// ============================================================================
// VIEW: RouteVehiclesGrid (НИЖНЯЯ ЧАСТЬ ЛЕВОЙ ПАНЕЛИ)
// ============================================================================
Ext.define('Store.passenger_transit.view.RouteVehiclesGrid', {
    extend: 'Ext.grid.Panel',
    cls: 'pt-vehicles-grid',
    title: null,

    initComponent: function () {
        var me = this;

        me.store = Ext.create('Ext.data.Store', {
            fields: [
                { name: 'vehicle_id', type: 'string' },
                { name: 'vehicle_number', type: 'string' },
                { name: 'direction', type: 'string' },
                { name: 'trips_count', type: 'int' },
                { name: 'online', type: 'boolean' },
                { name: 'lat', type: 'float' },
                { name: 'lon', type: 'float' }
            ]
        });

        me.columns = [
            {
                text: l('Госномер'), dataIndex: 'vehicle_number', flex: 1.2,
                renderer: function(value, meta, record) {
                    var online = record.get('online');
                    var color = online ? '#16a34a' : '#94a3b8';
                    var dot = online
                        ? '<span style="color:#16a34a;font-size:10px">●</span> '
                        : '<span style="color:#cbd5e1;font-size:10px">●</span> ';
                    return '<span style="font-weight:600;color:' + color + '">' + dot + Ext.String.htmlEncode(value || 'N/A') + '</span>';
                }
            },
            {
                text: l('Направление'), dataIndex: 'direction', width: 70, align: 'center', sortable: true,
                renderer: function(value) {
                    if (value === 'forward') {
                        return '<div class="pt-direction-badge pt-direction-forward" title="' + l('Прямое') + '">' +
                               '<i class="fa fa-long-arrow-right"></i></div>';
                    } else if (value === 'backward') {
                        return '<div class="pt-direction-badge pt-direction-backward" title="' + l('Обратное') + '">' +
                               '<i class="fa fa-long-arrow-left"></i></div>';
                    }
                    return '<span style="color:#94a3b8">—</span>';
                }
            },
            {
                text: l('Рейсов'), dataIndex: 'trips_count', width: 65, align: 'center', sortable: true,
                renderer: function(value) {
                    var num = parseInt(value) || 0;
                    var color = num > 5 ? '#16a34a' : (num > 0 ? '#f59e0b' : '#cbd5e1');
                    return '<span style="font-weight:700;color:' + color + '">' + num + '</span>';
                }
            }
        ];

        me.emptyText = '<div class="pt-vehicles-empty">' +
                       '<i class="fa fa-bus" style="font-size:32px;color:#cbd5e1"></i>' +
                       '<div style="margin-top:8px;color:#94a3b8;font-size:12px">' +
                       l('Выберите маршрут для просмотра ТС') +
                       '</div></div>';

        me.viewConfig = {
            stripeRows: true,
            getRowClass: function(record) {
                return record.get('online') ? 'pt-vehicle-row-online' : 'pt-vehicle-row-offline';
            }
        };

        me.listeners = {
            itemclick: function(view, record) {
                if (me.module && me.module.state.selectedRoute) {
                    me.module.selectVehicle(record.get('vehicle_id'), me.module.state.selectedRoute);
                }
            },
            scope: me
        };

        me.selModel = Ext.create('Ext.selection.RowModel', { mode: 'SINGLE' });
        me.callParent(arguments);
    }
});


// ============================================================================
// VIEW: StopsCatalogPanel (СПРАВОЧНИК ОСТАНОВОК)
// ============================================================================
Ext.define('Store.passenger_transit.view.StopsCatalogPanel', {
    extend: 'Ext.grid.Panel',
    cls: 'pt-stops-catalog-panel',
    title: l('Справочник остановок'),
    iconCls: 'fa fa-map-marker',

    initComponent: function () {
        var me = this;

        me.store = Ext.create('Ext.data.Store', {
            fields: ['id', 'name', 'identifier', 'description', 'lat', 'lon', 'radius', 'rfid_tag_id', 'rfid_code', 'rfid_name']
        });

        me.tbar = [
            {
                text: l('Добавить остановку'),
                iconCls: 'fa fa-plus',
                cls: 'pt-btn-add-stop',
                handler: function() {
                    if (me.module) me.module.enterAddStopMode();
                },
                tooltip: l('Создать новую остановку')
            },
            '-',
            {
                text: l('Удалить'),
                iconCls: 'fa fa-trash',
                handler: function() {
                    var sel = me.getSelectionModel().getSelection();
                    if (sel.length === 0) {
                        Ext.Msg.alert(l('Внимание'), l('Выберите остановку'));
                        return;
                    }
                    if (me.module) me.module.deleteStopFromCatalog(sel[0].get('id'));
                }
            },
            '->',
            {
                xtype: 'textfield',
                emptyText: l('Поиск...'),
                width: 150,
                enableKeyEvents: true,
                listeners: {
                    keyup: function(f) {
                        me.store.clearFilter();
                        var val = f.getValue().toLowerCase();
                        if (val) {
                            me.store.filterBy(function(r) {
                                return (r.get('name') || '').toLowerCase().indexOf(val) !== -1 ||
                                       (r.get('identifier') || '').toLowerCase().indexOf(val) !== -1 ||
                                       (r.get('rfid_code') || '').toLowerCase().indexOf(val) !== -1;
                            });
                        }
                    }
                }
            }
        ];

        me.columns = [
            {
                text: l('Название'), dataIndex: 'name', flex: 1.5,
                renderer: function(v, m, r) {
                    var id = r.get('identifier');
                    var idHtml = id ? '<div style="color:#94a3b8;font-size:10px;font-weight:400">ID: ' + Ext.String.htmlEncode(id) + '</div>' : '';
                    return '<span style="font-weight:600"><i class="fa fa-map-marker" style="color:#f59e0b;margin-right:4px"></i>' +
                           Ext.String.htmlEncode(v) + '</span>' + idHtml;
                }
            },
            {
                text: 'RFID', dataIndex: 'rfid_code', width: 70, align: 'center',
                renderer: function(v) {
                    if (!v) return '<span style="color:#cbd5e1">—</span>';
                    return '<span style="color:#7c3aed;font-weight:600;font-size:11px" title="' + Ext.String.htmlEncode(v) + '">' +
                           '<i class="fa fa-microchip"></i> ' + Ext.String.htmlEncode(v.substring(0, 6)) +
                           (v.length > 6 ? '..' : '') + '</span>';
                }
            },
            {
                text: l('R'), dataIndex: 'radius', width: 50, align: 'center',
                renderer: function(v) {
                    return '<span style="color:#64748b;font-size:11px">' + (v || 30) + '</span>';
                }
            },
            {
                text: '', dataIndex: 'id', width: 80, align: 'center', sortable: false, menuDisabled: true,
                renderer: function(value) {
                    return '<div class="pt-stop-actions-cell">' +
                           '<button class="pt-btn-focus-stop" data-stop-id="' + value + '" title="' + l('Показать на карте') + '">' +
                           '<i class="fa fa-crosshairs"></i></button>' +
                           '<button class="pt-btn-edit-stop" data-stop-id="' + value + '" title="' + l('Редактировать (геозона)') + '">' +
                           '<i class="fa fa-edit"></i></button>' +
                           '</div>';
                }
            }
        ];

        me.emptyText = '<div class="pt-stops-empty">' +
                       '<i class="fa fa-map-marker" style="font-size:32px;color:#cbd5e1"></i>' +
                       '<div style="margin-top:8px;color:#94a3b8;font-size:12px">' +
                       l('Справочник пуст. Нажмите "Добавить остановку"') +
                       '</div></div>';

        me.listeners = {
            itemclick: function(view, record) {
                if (me.module) {
                    var stop = me.module.state.stopsCatalog.find(function(s) { return s.id === record.get('id'); });
                    if (stop) me.module.focusOnStop(stop);
                }
            },
            cellclick: function(view, cell, cellIndex, record, row, rowIndex, e) {
                var target = e.target;
                if (!target) return;

                var stopId = parseInt(target.getAttribute('data-stop-id') ||
                                     (target.parentElement && target.parentElement.getAttribute('data-stop-id')));
                if (!stopId) return;

                var stop = me.module.state.stopsCatalog.find(function(s) { return s.id === stopId; });
                if (!stop) return;

                if (target.classList.contains('pt-btn-focus-stop') ||
                    (target.parentElement && target.parentElement.classList.contains('pt-btn-focus-stop'))) {
                    me.module.focusOnStop(stop);
                    return;
                }

                if (target.classList.contains('pt-btn-edit-stop') ||
                    (target.parentElement && target.parentElement.classList.contains('pt-btn-edit-stop'))) {
                    me.module.editCatalogStop(stop);
                    return;
                }
            }
        };

        me.callParent(arguments);
    },

    loadStops: function(stops) {
        this.getStore().loadData(stops);
    }
});


// ============================================================================
// VIEW: StopEditPanel (ПАНЕЛЬ РЕДАКТИРОВАНИЯ ОСТАНОВКИ)
// ============================================================================
Ext.define('Store.passenger_transit.view.StopEditPanel', {
    extend: 'Ext.panel.Panel',
    cls: 'pt-stop-edit-panel',
    layout: 'fit',
    autoScroll: true,

    initComponent: function () {
        var me = this;

        me.currentMode = 'create';
        me.currentStopId = null;
        me.selectedRfidTag = null;

        me.items = [{
            xtype: 'form',
            itemId: 'stopForm',
            bodyPadding: 12,
            border: false,
            autoScroll: true,
            defaults: {
                anchor: '100%',
                msgTarget: 'side',
                labelWidth: 95
            },
            items: [
                {
                    xtype: 'container',
                    cls: 'pt-stop-edit-header',
                    itemId: 'headerContainer',
                    html: '<div class="pt-stop-edit-header-inner">' +
                          '<i class="fa fa-plus-circle"></i> ' +
                          '<span>' + l('Новая остановка') + '</span>' +
                          '</div>'
                },
                {
                    xtype: 'textfield',
                    name: 'name', itemId: 'stopName',
                    fieldLabel: l('Название') + ':',
                    emptyText: l('Например: пл. Ленина'),
                    allowBlank: false, minLength: 2, maxLength: 100
                },
                {
                    xtype: 'textfield',
                    name: 'identifier', itemId: 'stopIdentifier',
                    fieldLabel: l('Идентификатор') + ':',
                    emptyText: l('Уникальный код остановки'),
                    maxLength: 50
                },
                {
                    xtype: 'textarea',
                    name: 'description', itemId: 'stopDescription',
                    fieldLabel: l('Описание') + ':',
                    emptyText: l('Необязательное описание'),
                    maxLength: 255, height: 55,
                    grow: true, growMin: 40, growMax: 100
                },
                {
                    xtype: 'fieldcontainer',
                    fieldLabel: l('Координаты') + ':',
                    layout: 'hbox',
                    defaults: {
                        flex: 1, labelWidth: 25,
                        decimalPrecision: 6, allowDecimals: true, allowBlank: false
                    },
                    items: [
                        {
                            xtype: 'numberfield', name: 'lat', itemId: 'stopLat',
                            fieldLabel: l('Шир'), value: null,
                            minValue: -90, maxValue: 90,
                            readOnly: true, cls: 'pt-readonly-field'
                        },
                        {
                            xtype: 'numberfield', name: 'lon', itemId: 'stopLon',
                            fieldLabel: l('Дол'), value: null,
                            margin: '0 0 0 6', minValue: -180, maxValue: 180,
                            readOnly: true, cls: 'pt-readonly-field'
                        }
                    ]
                },
                {
                    xtype: 'container',
                    cls: 'pt-coords-hint',
                    html: '<i class="fa fa-info-circle"></i> ' +
                          l('Перетаскивайте маркеры на карте для изменения координат и радиуса')
                },
                {
                    xtype: 'numberfield',
                    name: 'radius', itemId: 'stopRadius',
                    fieldLabel: l('Радиус (м)') + ':',
                    value: 30, minValue: 5, maxValue: 5000, step: 5,
                    listeners: {
                        change: function(field, newValue) {
                            if (me.module && me.module.state.mapLayers.editingStopZone) {
                                me.module.state.mapLayers.editingStopZone.circle.setRadius(newValue);
                                me.module._updateEditingZoneMarkers();
                            }
                        }
                    }
                },
                {
                    xtype: 'container',
                    cls: 'pt-rfid-selector',
                    itemId: 'rfidSelector',
                    layout: 'hbox',
                    fieldLabel: l('RFID метка') + ':',
                    labelWidth: 95,
                    items: [
                        {
                            xtype: 'displayfield', itemId: 'rfidDisplay',
                            flex: 1, cls: 'pt-rfid-display',
                            value: '<span class="pt-rfid-empty">' + l('Не выбрана') + '</span>'
                        },
                        {
                            xtype: 'button', itemId: 'rfidSelectBtn',
                            iconCls: 'fa fa-microchip', cls: 'pt-btn-rfid-select',
                            tooltip: l('Выбрать RFID метку'),
                            handler: function() { me.onSelectRfidClick(); }
                        },
                        {
                            xtype: 'button', itemId: 'rfidClearBtn',
                            iconCls: 'fa fa-times', cls: 'pt-btn-rfid-clear',
                            tooltip: l('Очистить выбор'), hidden: true,
                            handler: function() { me.clearRfidSelection(); }
                        }
                    ]
                },
                {
                    xtype: 'container',
                    cls: 'pt-stop-edit-actions',
                    layout: 'hbox',
                    margin: '12 0 0 0',
                    defaults: { flex: 1, margin: '0 4 0 0' },
                    items: [
                        {
                            xtype: 'button',
                            text: l('Сохранить'), iconCls: 'fa fa-check',
                            cls: 'pt-btn-primary pt-btn-save',
                            handler: function() { me.onSaveClick(); }
                        },
                        {
                            xtype: 'button',
                            text: l('Отмена'), iconCls: 'fa fa-times',
                            cls: 'pt-btn-cancel',
                            handler: function() {
                                if (me.module) me.module.cancelStopEdit();
                            }
                        }
                    ]
                }
            ]
        }];

        me.callParent(arguments);
    },

    setMode: function(mode) {
        var me = this;
        me.currentMode = mode;
        var header = me.down('#headerContainer');
        if (header) {
            var icon = mode === 'create' ? 'fa-plus-circle' : 'fa-edit';
            var title = mode === 'create' ? l('Новая остановка') : l('Редактирование остановки');
            header.update('<div class="pt-stop-edit-header-inner pt-mode-' + mode + '">' +
                          '<i class="fa ' + icon + '"></i> ' +
                          '<span>' + title + '</span>' +
                          '</div>');
        }
    },

    resetForm: function() {
        var me = this;
        var form = me.down('#stopForm');
        if (form) {
            form.getForm().reset();
            me.down('#stopRadius').setValue(30);
        }
        me.clearRfidSelection();
        me.currentStopId = null;
    },

    loadStopData: function(stop) {
        var me = this;
        var form = me.down('#stopForm');
        if (form) {
            form.getForm().setValues({
                name: stop.name || '',
                identifier: stop.identifier || '',
                description: stop.description || '',
                lat: stop.lat,
                lon: stop.lon,
                radius: stop.radius || 30
            });
        }
        me.currentStopId = stop.id;

        if (stop.rfid_tag_id) {
            me.selectedRfidTag = {
                id: stop.rfid_tag_id,
                code: stop.rfid_code || '',
                name: stop.rfid_name || ''
            };
            me.updateRfidDisplay();
        } else {
            me.clearRfidSelection();
        }
    },

    setCoords: function(lat, lon) {
        var me = this;
        me.down('#stopLat').setValue(parseFloat(lat.toFixed(6)));
        me.down('#stopLon').setValue(parseFloat(lon.toFixed(6)));
    },

    setRadius: function(radius) {
        this.down('#stopRadius').setValue(radius);
    },

    onSelectRfidClick: function() {
        var me = this;
        if (!me.module) return;

        me.module.showRfidSelectWindow(
            me.selectedRfidTag ? me.selectedRfidTag.id : null,
            function(tag) {
                if (tag) {
                    me.selectedRfidTag = tag;
                    me.updateRfidDisplay();
                }
            }
        );
    },

    clearRfidSelection: function() {
        var me = this;
        me.selectedRfidTag = null;
        me.updateRfidDisplay();
    },

    updateRfidDisplay: function() {
        var me = this;
        var display = me.down('#rfidDisplay');
        var clearBtn = me.down('#rfidClearBtn');

        if (!display) return;

        if (me.selectedRfidTag) {
            var tag = me.selectedRfidTag;
            var namePart = tag.name ? ' — ' + Ext.String.htmlEncode(tag.name) : '';
            display.setValue(
                '<span class="pt-rfid-selected">' +
                '<i class="fa fa-microchip"></i> ' +
                '<b>' + Ext.String.htmlEncode(tag.code) + '</b>' +
                namePart +
                '</span>'
            );
            if (clearBtn) clearBtn.show();
        } else {
            display.setValue('<span class="pt-rfid-empty">' + l('Не выбрана') + '</span>');
            if (clearBtn) clearBtn.hide();
        }
    },

    onSaveClick: function() {
        var me = this;
        var form = me.down('#stopForm').getForm();

        if (!form.isValid()) {
            Ext.toast({ html: l('Заполните все обязательные поля'), align: 't', timeout: 2500 });
            return;
        }

        var values = form.getValues();
        var name = String(values.name).trim();
        if (name.length < 2) {
            Ext.Msg.alert(l('Ошибка'), l('Название должно содержать минимум 2 символа'));
            return;
        }

        var lat = parseFloat(values.lat);
        var lon = parseFloat(values.lon);
        if (isNaN(lat) || isNaN(lon)) {
            Ext.Msg.alert(l('Ошибка'), l('Укажите координаты'));
            return;
        }

        var data = {
            name: name,
            identifier: values.identifier ? String(values.identifier).trim() : null,
            description: values.description ? String(values.description).trim() : null,
            lat: lat,
            lon: lon,
            radius: parseInt(values.radius) || 30,
            rfid_tag_id: me.selectedRfidTag ? me.selectedRfidTag.id : null
        };

        if (me.module) {
            me.module.saveStopFromPanel(data);
        }
    }
});


// ============================================================================
// VIEW: RfidSelectWindow
// ============================================================================
Ext.define('Store.passenger_transit.view.RfidSelectWindow', {
    extend: 'Ext.window.Window',
    alias: 'widget.pt-rfidselectwindow',
    cls: 'pt-rfid-select-window',
    modal: true,
    width: 650,
    height: 480,
    layout: 'border',
    closable: true,
    resizable: true,
    closeAction: 'destroy',
    title: '<i class="fa fa-microchip"></i> ' + l('Выбор RFID метки'),

    initComponent: function () {
        var me = this;

        me.tagStore = Ext.create('Ext.data.Store', {
            fields: ['id', 'code', 'name', 'description'],
            data: me.module ? me.module.state.rfidTags : []
        });

        me.items = [
            {
                region: 'center',
                xtype: 'grid',
                itemId: 'tagsGrid',
                store: me.tagStore,
                selModel: { selType: 'rowmodel', mode: 'SINGLE' },
                columns: [
                    {
                        text: l('Код метки'), dataIndex: 'code', flex: 1.2,
                        renderer: function(v) {
                            return '<span style="font-weight:700;color:#7c3aed;font-family:monospace">' +
                                   '<i class="fa fa-microchip" style="margin-right:4px"></i>' +
                                   Ext.String.htmlEncode(v) + '</span>';
                        }
                    },
                    { text: l('Название'), dataIndex: 'name', flex: 1 },
                    {
                        text: l('Описание'), dataIndex: 'description', flex: 1.2,
                        renderer: function(v) {
                            return '<span style="color:#64748b;font-size:12px">' + Ext.String.htmlEncode(v || '') + '</span>';
                        }
                    }
                ],
                tbar: [
                    {
                        xtype: 'textfield', itemId: 'searchField',
                        emptyText: l('Поиск по коду, названию...'),
                        width: 220, enableKeyEvents: true,
                        listeners: {
                            keyup: function(f) { me.filterTags(f.getValue()); }
                        }
                    },
                    '->',
                    {
                        text: l('Обновить'), iconCls: 'fa fa-refresh',
                        handler: function() { me.refreshTags(); }
                    }
                ],
                listeners: {
                    select: function(grid, record) { me.selectedTag = record.data; }
                }
            },
            {
                region: 'south',
                height: 140,
                split: true,
                collapsible: true,
                title: l('Создать новую метку'),
                titleCollapse: true,
                bodyPadding: 10,
                defaults: { anchor: '100%', labelWidth: 90 },
                items: [
                    {
                        xtype: 'textfield', itemId: 'newCode',
                        fieldLabel: l('Код') + ':',
                        emptyText: l('Уникальный код метки'),
                        allowBlank: false
                    },
                    {
                        xtype: 'textfield', itemId: 'newName',
                        fieldLabel: l('Название') + ':',
                        emptyText: l('Например: Метка автобуса №1')
                    },
                    {
                        xtype: 'button',
                        text: l('Создать метку'), iconCls: 'fa fa-plus',
                        cls: 'pt-btn-primary',
                        handler: function() { me.onCreateTagClick(); }
                    }
                ]
            }
        ];

        me.buttons = [
            {
                text: l('Выбрать'), iconCls: 'fa fa-check', cls: 'pt-btn-primary',
                handler: function() {
                    if (me.selectedTag) {
                        me.fireEvent('select', me, me.selectedTag);
                        me.close();
                    } else {
                        Ext.Msg.alert(l('Внимание'), l('Выберите метку из списка'));
                    }
                }
            },
            {
                text: l('Без метки'), iconCls: 'fa fa-ban',
                handler: function() { me.fireEvent('clear', me); me.close(); }
            },
            {
                text: l('Отмена'), iconCls: 'fa fa-times',
                handler: function() { me.close(); }
            }
        ];

        if (me.currentTagId) {
            me.on('afterrender', function() {
                var grid = me.down('#tagsGrid');
                var idx = me.tagStore.find('id', me.currentTagId);
                if (idx !== -1) grid.getSelectionModel().select(idx);
            });
        }

        me.callParent(arguments);
    },

    filterTags: function(searchText) {
        var me = this;
        me.tagStore.clearFilter();
        if (searchText && searchText.trim()) {
            var val = searchText.toLowerCase();
            me.tagStore.filterBy(function(r) {
                return (r.get('code') || '').toLowerCase().indexOf(val) !== -1 ||
                       (r.get('name') || '').toLowerCase().indexOf(val) !== -1 ||
                       (r.get('description') || '').toLowerCase().indexOf(val) !== -1;
            });
        }
    },

    refreshTags: function() {
        var me = this;
        if (me.module) {
            Ext.Ajax.request({
                url: me.module.getBackendUrl('rfid-tags'),
                method: 'GET',
                success: function (resp) {
                    var data = Ext.decode(resp.responseText);
                    if (data.success) {
                        me.module.state.rfidTags = data.tags || [];
                        me.tagStore.loadData(data.tags || []);
                    }
                }
            });
        }
    },

    onCreateTagClick: function() {
        var me = this;
        var code = me.down('#newCode').getValue();
        var name = me.down('#newName').getValue();

        if (!code || String(code).trim().length < 2) {
            Ext.Msg.alert(l('Ошибка'), l('Укажите код метки (минимум 2 символа)'));
            return;
        }

        me.fireEvent('createTag', me, {
            code: String(code).trim(),
            name: name ? String(name).trim() : null
        });

        me.down('#newCode').setValue('');
        me.down('#newName').setValue('');
    }
});


// ============================================================================
// VIEW: RouteMemoPanel (МНЕМОСХЕМА)
// ============================================================================
Ext.define('Store.passenger_transit.view.RouteMemoPanel', {
    extend: 'Ext.panel.Panel',
    layout: 'fit',
    cls: 'pt-memo-panel',

    initComponent: function () {
        var me = this;
        me.tbar = [
            { text: l('Прямой'), iconCls: 'fa fa-arrow-right', handler: function () { me.showDirection('forward'); }, scope: me },
            { text: l('Обратный'), iconCls: 'fa fa-arrow-left', handler: function () { me.showDirection('backward'); }, scope: me }
        ];
        me.items = [{
            xtype: 'panel',
            itemId: 'memoContent',
            autoScroll: true,
            html: '<div class="pt-memo-empty">' + l('Выберите маршрут') + '</div>'
        }];
        me.callParent(arguments);
    },

    loadRoute: function (route) {
        var me = this;
        me.currentRoute = route;
        me.currentDirection = 'forward';
        me.down('#memoContent').update(me.renderMemo(route, 'forward'));
    },

    renderMemo: function (route, direction) {
        if (!route || !route.stops || route.stops.length === 0) {
            return '<div class="pt-memo-empty">' + l('Нет остановок') + '</div>';
        }
        var stops = route.stops;
        var html = '<div class="pt-memo-route">';
        html += '<div class="pt-memo-header">' + Ext.String.htmlEncode(route.name) + '</div>';
        html += '<div class="pt-memo-stops">';
        stops.forEach(function (stop, index) {
            var isForward = direction === 'forward';
            var cls = isForward ? 'pt-stop-forward' : 'pt-stop-backward';
            var number = isForward ? (index + 1) : (stops.length - index);
            html += '<div class="pt-memo-stop ' + cls + '" data-index="' + index + '">';
            html += '<div class="pt-memo-stop-number">' + number + '</div>';
            html += '<div class="pt-memo-stop-name">' + Ext.String.htmlEncode(stop.name) + '</div>';
            html += '</div>';
        });
        html += '</div></div>';
        return html;
    },

    highlightStop: function (index) {
        var me = this;
        var content = me.down('#memoContent');
        if (!content) return;
        var el = content.getEl();
        if (el) {
            el.query('.pt-memo-stop').forEach(function (node) {
                Ext.fly(node).removeCls('pt-memo-stop-highlight');
            });
            var target = el.query('.pt-memo-stop[data-index="' + index + '"]')[0];
            if (target) {
                Ext.fly(target).addCls('pt-memo-stop-highlight');
                target.scrollIntoView();
            }
        }
    },

    showDirection: function (direction) {
        if (this.currentRoute) {
            this.down('#memoContent').update(this.renderMemo(this.currentRoute, direction));
            this.currentDirection = direction;
        }
    }
});


// ============================================================================
// VIEW: TimelinePanel (ГРАФИК РЕЙСОВ)
// ============================================================================
Ext.define('Store.passenger_transit.view.TimelinePanel', {
    extend: 'Ext.panel.Panel',
    layout: 'fit',
    cls: 'pt-timeline-panel',

    initComponent: function () {
        var me = this;
        me.items = [{
            xtype: 'panel',
            itemId: 'chartContainer',
            html: '<div id="pt-timeline-chart" style="width:100%;height:100%;"></div>'
        }];
        me.callParent(arguments);
    },

    renderChart: function (timelineData) {
        if (!window.Highcharts) {
            Ext.log('passenger_transit: Highcharts not available');
            return;
        }
        var container = document.getElementById('pt-timeline-chart');
        if (!container) return;
        if (this.chart) this.chart.destroy();
        this.chart = Highcharts.chart(container, {
            chart: { type: 'column', backgroundColor: 'transparent' },
            title: { text: l('Рейсы по времени') },
            xAxis: { categories: timelineData.hours || [], title: { text: l('Время') } },
            yAxis: { title: { text: l('Количество рейсов') }, min: 0 },
            series: [{ name: l('Рейсы'), data: timelineData.trips || [], color: '#2563eb' }],
            credits: { enabled: false }
        });
    }
});
