// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки
// Архитектура: Справочник остановок (геозоны) + Маршруты
// Backend: Node.js + SQLite (доступен через Ngrok)

Ext.define('Store.passenger_transit.Module', {
    extend: 'Ext.Component',
    extensionName: 'passenger_transit',

    // URL Node.js бэкенда (обновляйте при перезапуске ngrok)
    backendBaseUrl: 'https://saggy-return-aide.ngrok-free.dev',

    getBackendUrl: function(action) {
        return this.backendBaseUrl + '/api/' + action;
    },

    state: {
        // Справочник остановок (НЕЗАВИСИМЫЙ)
        stopsCatalog: [],
        // Маршруты
        routes: [],
        selectedRoute: null,
        selectedVehicle: null,
        // Режимы
        addStopMode: false,
        editStopMode: false,
        editingStopId: null,
        routeEditMode: false,
        editDirection: 'forward',
        editingRoutePoints: [],
        // Привязанные ТС из PILOT
        pilotVehicles: [],
        // Слои карты
        mapLayers: {
            stopZones: {},          // геозоны остановок {stopId: L.circle}
            stopLabels: {},         // подписи остановок {stopId: L.marker}
            routePolylines: {},     // полилинии маршрутов
            routeStops: {},         // подсвеченные остановки маршрута
            vehicles: {},
            tracks: {},
            editingZone: null,      // редактируемая геозона
            editingHandle: null,    // "ручка" для изменения радиуса
            editingPolyline: null   // редактируемая полилиния маршрута
        },
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

        // ====================================================================
        // ГАРАНТИРОВАННЫЙ ОБХОД ПРЕДУПРЕЖДЕНИЯ NGROK (Free Tier)
        // ====================================================================
        Ext.Ajax.on('beforerequest', function(conn, options) {
            options.headers = options.headers || {};
            options.headers['ngrok-skip-browser-warning'] = 'true';
        });
        // ====================================================================

        // Load CSS
        var cssHref = me.getModuleBaseUrl() + 'style.css';
        if (!document.querySelector('link[href="' + cssHref + '"]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssHref;
            document.head.appendChild(link);
        }

        // ====================================================================
        // СОЗДАЕМ ДЕРЕВО МАРШРУТОВ И СОХРАНЯЕМ ССЫЛКУ
        // ====================================================================
        me.routeTree = Ext.create('Store.passenger_transit.view.RouteTree', {
            module: me
        });

        // ====================================================================
        // СОЗДАЕМ ГРИД ТС МАРШРУТА (НИЖНЯЯ ЧАСТЬ ЛЕВОЙ ПАНЕЛИ)
        // ====================================================================
        me.vehiclesGrid = Ext.create('Store.passenger_transit.view.RouteVehiclesGrid', {
            module: me
        });

        // ====================================================================
        // КОНТЕЙНЕР: РАЗДЕЛЕНИЕ ЛЕВОЙ ПАНЕЛИ НА 2 ЧАСТИ (ВЕРХ / НИЗ)
        // ====================================================================
        me.leftContent = Ext.create('Ext.panel.Panel', {
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

        // Create navigation tab
        me.navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 380,
            layout: 'fit',
            items: [me.leftContent]
        });

        // Карта PILOT остается видимой (НЕ перекрываем её)
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

            // ====================================================================
            // ОБРАБОТЧИК ПЕРЕКЛЮЧЕНИЯ ВКЛАДОК
            // ====================================================================
            if (skeleton.navigation.on) {
                skeleton.navigation.on('tabchange', function(tabPanel, newTab) {
                    if (newTab === me.navTab) {
                        me.onTabActivated();
                    } else {
                        me.onTabDeactivated();
                    }
                });
            }

            // Load data
            me.loadStopsCatalog();
            me.loadRoutes();
            me.loadVehiclesFromPilot();

            // Создаем плавающие панели после инициализации
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

    // ==================== УПРАВЛЕНИЕ ВИДИМОСТЬЮ ПАНЕЛЕЙ ====================

    onTabActivated: function() {
        var me = this;
        me.state.isTabActive = true;
        me.showFloatingPanels();
    },

    onTabDeactivated: function() {
        var me = this;
        me.state.isTabActive = false;
        me.hideFloatingPanels();
    },

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
                        id: item.id,
                        name: item.name,
                        number: item.number || item.name,
                        group: parentGroup || '',
                        lat: item.lat || 0,
                        lon: item.lon || item.lng || 0,
                        dir: item.dir || 0,
                        speed: item.speed || 0,
                        online: item.state === 1
                    });
                }
            });
        }
        walk(groups);
        return vehicles;
    },

    // ==================== СПРАВОЧНИК ОСТАНОВОК ====================

    loadStopsCatalog: function () {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('stops'),
            method: 'GET',
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    me.state.stopsCatalog = data.stops || [];
                    me.drawAllStopZones();
                }
            },
            failure: function () {
                Ext.log('passenger_transit: failed to load stops catalog');
            }
        });
    },

    // Отрисовка всех геозон остановок на карте (серые круги)
    drawAllStopZones: function () {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me.clearAllStopZones();

        me.state.stopsCatalog.forEach(function (stop) {
            // Геозона (круг)
            var circle = L.circle([stop.lat, stop.lon], {
                radius: stop.radius || 30,
                color: '#94a3b8',
                weight: 2,
                fillColor: '#cbd5e1',
                fillOpacity: 0.25,
                className: 'pt-stop-zone'
            }).addTo(map.map);

            // Подпись (название)
            var label = L.marker([stop.lat, stop.lon], {
                icon: L.divIcon({
                    className: 'pt-stop-label',
                    html: '<div class="pt-stop-label-text">' + Ext.String.htmlEncode(stop.name) + '</div>',
                    iconSize: [0, 0],
                    iconAnchor: [0, -25]
                }),
                interactive: false
            }).addTo(map.map);

            // Popup с названием и кнопками
            circle.bindPopup(
                '<div class="pt-stop-popup">' +
                '<b>' + Ext.String.htmlEncode(stop.name) + '</b><br/>' +
                '<small>' + l('Радиус') + ': ' + (stop.radius || 30) + ' м</small><br/>' +
                '<div class="pt-stop-popup-buttons">' +
                '<button class="pt-btn-edit" data-stop-id="' + stop.id + '">' +
                '<i class="fa fa-edit"></i> ' + l('Редактировать') + '</button>' +
                '<button class="pt-btn-delete" data-stop-id="' + stop.id + '">' +
                '<i class="fa fa-trash"></i> ' + l('Удалить') + '</button>' +
                '</div></div>'
            );

            // Обработчики кнопок в popup
            circle.on('popupopen', function () {
                setTimeout(function () {
                    var popupEl = circle.getPopup().getElement();
                    if (!popupEl) return;
                    var editBtn = popupEl.querySelector('.pt-btn-edit');
                    var deleteBtn = popupEl.querySelector('.pt-btn-delete');
                    if (editBtn) {
                        editBtn.onclick = function () {
                            circle.closePopup();
                            me.enableStopEditMode(stop.id);
                        };
                    }
                    if (deleteBtn) {
                        deleteBtn.onclick = function () {
                            circle.closePopup();
                            me.confirmDeleteStop(stop.id, stop.name);
                        };
                    }
                }, 50);
            });

            // Drag центра геозоны
            me.enableZoneDrag(circle, stop);

            me.state.mapLayers.stopZones[stop.id] = circle;
            me.state.mapLayers.stopLabels[stop.id] = label;
        });
    },

    clearAllStopZones: function () {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        for (var id in this.state.mapLayers.stopZones) {
            map.map.removeLayer(this.state.mapLayers.stopZones[id]);
        }
        for (var id in this.state.mapLayers.stopLabels) {
            map.map.removeLayer(this.state.mapLayers.stopLabels[id]);
        }
        this.state.mapLayers.stopZones = {};
        this.state.mapLayers.stopLabels = {};
    },

    // Drag центра геозоны
    enableZoneDrag: function (circle, stop) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        var dragging = false;

        circle.on('mousedown', function (e) {
            if (me.state.addStopMode || me.state.editStopMode) return;
            if (e.originalEvent) e.originalEvent.preventDefault();
            dragging = true;
            map.map.dragging.disable();
            if (e.originalEvent) L.DomEvent.disableImageDrag(e.originalEvent);
        });

        map.map.on('mousemove', function (e) {
            if (!dragging) return;
            circle.setLatLng(e.latlng);
            if (me.state.mapLayers.stopLabels[stop.id]) {
                me.state.mapLayers.stopLabels[stop.id].setLatLng(e.latlng);
            }
        });

        map.map.on('mouseup', function () {
            if (!dragging) return;
            dragging = false;
            map.map.dragging.enable();
            var newLatLng = circle.getLatLng();
            // Сохраняем новые координаты на сервере
            Ext.Ajax.request({
                url: me.getBackendUrl('stops/' + stop.id),
                method: 'PUT',
                jsonData: { lat: newLatLng.lat, lon: newLatLng.lng },
                success: function () {
                    stop.lat = newLatLng.lat;
                    stop.lon = newLatLng.lng;
                    Ext.toast({ html: l('Координаты сохранены'), align: 'br', timeout: 1500 });
                }
            });
        });
    },

    // ==================== РЕЖИМ ДОБАВЛЕНИЯ НОВОЙ ОСТАНОВКИ ====================

    enableAddStopMode: function () {
        var me = this;
        me.state.addStopMode = true;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me._addStopClickHandler = function (e) {
            if (!me.state.addStopMode) return;
            me.showAddStopWindow({
                lat: parseFloat(e.latlng.lat.toFixed(6)),
                lon: parseFloat(e.latlng.lng.toFixed(6))
            });
        };
        map.map.on('click', me._addStopClickHandler);
        Ext.toast({
            html: l('Кликните по карте для добавления остановки'),
            align: 't', timeout: 8000
        });
    },

    disableAddStopMode: function () {
        var me = this;
        me.state.addStopMode = false;
        var map = me.getPilotMap();
        if (map && map.map && me._addStopClickHandler) {
            map.map.off('click', me._addStopClickHandler);
        }
    },

    showAddStopWindow: function (coords) {
        var me = this;

        // Предварительная геозона на карте
        me._previewZone = L.circle([coords.lat, coords.lon], {
            radius: 30,
            color: '#f59e0b',
            weight: 2,
            fillColor: '#fbbf24',
            fillOpacity: 0.3,
            dashArray: '5, 5'
        }).addTo(me.getPilotMap().map);

        me.addStopWindow = Ext.create('Store.passenger_transit.view.AddStopWindow', {
            module: me,
            coords: coords,
            listeners: {
                save: function (win, data) {
                    me.saveNewStop(data);
                    me.removePreviewZone();
                    me.disableAddStopMode();
                },
                cancel: function () {
                    me.removePreviewZone();
                    me.disableAddStopMode();
                },
                radiuschange: function (win, radius) {
                    if (me._previewZone) me._previewZone.setRadius(radius);
                }
            }
        });
        me.addStopWindow.show();
    },

    removePreviewZone: function () {
        if (this._previewZone) {
            var map = this.getPilotMap();
            if (map && map.map) map.map.removeLayer(this._previewZone);
            this._previewZone = null;
        }
    },

    saveNewStop: function (data) {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('stops'),
            method: 'POST',
            jsonData: data,
            success: function (resp) {
                var result = Ext.decode(resp.responseText);
                if (result.success) {
                    Ext.toast({ html: l('Остановка добавлена'), align: 't', timeout: 2000 });
                    me.loadStopsCatalog();
                } else {
                    Ext.Msg.alert(l('Ошибка'), result.error || l('Не удалось сохранить'));
                }
            },
            failure: function () {
                Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения с сервером'));
            }
        });
    },

    // ==================== РЕЖИМ РЕДАКТИРОВАНИЯ ГЕОЗОНЫ ====================

    enableStopEditMode: function (stopId) {
        var me = this;
        var stop = me.getStopById(stopId);
        if (!stop) return;

        me.state.editStopMode = true;
        me.state.editingStopId = stopId;

        var map = me.getPilotMap();
        if (!map || !map.map) return;

        // Скрываем оригинальную геозону
        if (me.state.mapLayers.stopZones[stopId]) {
            me.state.mapLayers.stopZones[stopId].remove();
        }
        if (me.state.mapLayers.stopLabels[stopId]) {
            me.state.mapLayers.stopLabels[stopId].remove();
        }

        // Создаём редактируемую геозону
        var editZone = L.circle([stop.lat, stop.lon], {
            radius: stop.radius || 30,
            color: '#f59e0b',
            weight: 3,
            fillColor: '#fbbf24',
            fillOpacity: 0.3,
            dashArray: '5, 5'
        }).addTo(map.map);
        me.state.mapLayers.editingZone = editZone;

        // "Ручка" для изменения радиуса
        var handleLatLng = me.calculateHandleLatLng([stop.lat, stop.lon], stop.radius || 30);
        var handle = L.marker(handleLatLng, {
            icon: L.divIcon({
                className: 'pt-zone-handle',
                html: '<div class="pt-zone-handle-dot"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            }),
            draggable: true
        }).addTo(map.map);
        me.state.mapLayers.editingHandle = handle;

        // Drag ручки → изменение радиуса
        handle.on('drag', function (e) {
            var center = editZone.getLatLng();
            var handlePos = e.target.getLatLng();
            var newRadius = center.distanceTo(handlePos);
            editZone.setRadius(newRadius);
            var newHandleLatLng = me.calculateHandleLatLng([center.lat, center.lng], newRadius);
            handle.setLatLng(newHandleLatLng);
        });

        // Drag центра геозоны
        editZone.on('mousedown', function (e) {
            if (e.originalEvent) e.originalEvent.preventDefault();
            map.map.dragging.disable();
            var startX = e.originalEvent.clientX;
            var startY = e.originalEvent.clientY;
            var startLatLng = editZone.getLatLng();

            function onMouseMove(ev) {
                var dx = ev.clientX - startX;
                var dy = ev.clientY - startY;
                var point = map.map.latLngToContainerPoint(startLatLng);
                var newPoint = L.point(point.x + dx, point.y + dy);
                var newLatLng = map.map.containerPointToLatLng(newPoint);
                editZone.setLatLng(newLatLng);
                handle.setLatLng(me.calculateHandleLatLng([newLatLng.lat, newLatLng.lng], editZone.getRadius()));
            }

            function onMouseUp() {
                map.map.dragging.enable();
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        me.showStopEditToolbar(stop);
    },

    calculateHandleLatLng: function (center, radiusMeters) {
        var earthRadius = 6378137;
        var dLat = 0;
        var dLon = radiusMeters / (earthRadius * Math.cos(Math.PI * center[0] / 180));
        return [center[0] + dLat * 180 / Math.PI, center[1] + dLon * 180 / Math.PI];
    },

    finishStopEdit: function (save) {
        var me = this;
        if (!me.state.editStopMode) return;

        var stopId = me.state.editingStopId;
        var editZone = me.state.mapLayers.editingZone;

        if (save && editZone) {
            var center = editZone.getLatLng();
            var radius = editZone.getRadius();
            Ext.Ajax.request({
                url: me.getBackendUrl('stops/' + stopId),
                method: 'PUT',
                jsonData: { lat: center.lat, lon: center.lng, radius: radius },
                success: function () {
                    Ext.toast({ html: l('Изменения сохранены'), align: 't', timeout: 2000 });
                    me.loadStopsCatalog();
                }
            });
        } else {
            me.loadStopsCatalog();
        }

        me.cleanupEditMode();
    },

    cleanupEditMode: function () {
        var me = this;
        var map = me.getPilotMap();
        if (map && map.map) {
            if (me.state.mapLayers.editingZone) {
                map.map.removeLayer(me.state.mapLayers.editingZone);
                me.state.mapLayers.editingZone = null;
            }
            if (me.state.mapLayers.editingHandle) {
                map.map.removeLayer(me.state.mapLayers.editingHandle);
                me.state.mapLayers.editingHandle = null;
            }
        }
        me.hideStopEditToolbar();
        me.state.editStopMode = false;
        me.state.editingStopId = null;
    },

    showStopEditToolbar: function (stop) {
        var me = this;
        if (!me.stopEditToolbar) {
            me.stopEditToolbar = Ext.create('Ext.toolbar.Toolbar', {
                cls: 'pt-stop-edit-toolbar',
                floating: true,
                x: 100, y: 100,
                items: [
                    { text: l('Сохранить'), iconCls: 'fa fa-check', handler: function () { me.finishStopEdit(true); }, scope: me },
                    { text: l('Отмена'), iconCls: 'fa fa-times', handler: function () { me.finishStopEdit(false); }, scope: me },
                    '-',
                    { xtype: 'tbtext', text: l('Остановка') + ': ' + stop.name, cls: 'pt-toolbar-info' }
                ]
            });
        }
        me.stopEditToolbar.show();
        Ext.toast({
            html: l('Тяните центр для перемещения. Тяните ручку для изменения радиуса.'),
            align: 't', timeout: 6000
        });
    },

    hideStopEditToolbar: function () {
        if (this.stopEditToolbar) this.stopEditToolbar.hide();
    },

    // ==================== УДАЛЕНИЕ ОСТАНОВКИ ====================

    confirmDeleteStop: function (stopId, stopName) {
        var me = this;
        Ext.Msg.confirm(
            l('Удаление остановки'),
            l('Удалить остановку') + ' "' + Ext.String.htmlEncode(stopName) + '"?<br/>' +
            l('Она будет удалена из справочника и всех маршрутов.'),
            function (btn) {
                if (btn === 'yes') {
                    Ext.Ajax.request({
                        url: me.getBackendUrl('stops/' + stopId),
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

    getStopById: function (stopId) {
        var found = null;
        Ext.each(this.state.stopsCatalog, function (s) {
            if (s.id == stopId) { found = s; return false; }
        });
        return found;
    },

    // ==================== МОДАЛЬНОЕ ОКНО СПРАВОЧНИКА ОСТАНОВОК ====================

    showStopsCatalogWindow: function () {
        var me = this;
        if (me.stopsCatalogWindow) {
            me.stopsCatalogWindow.show();
            me.stopsCatalogWindow.loadStops(me.state.stopsCatalog);
            return;
        }

        me.stopsCatalogWindow = Ext.create('Store.passenger_transit.view.StopsCatalogWindow', {
            module: me
        });
        me.stopsCatalogWindow.show();
        me.stopsCatalogWindow.loadStops(me.state.stopsCatalog);
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
            failure: function () {
                Ext.log('passenger_transit: failed to load routes from backend');
            }
        });
    },

    createRoute: function (name) {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('routes'),
            method: 'POST',
            jsonData: { name: name },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) me.loadRoutes();
            }
        });
    },

    selectRoute: function (routeId) {
        var me = this;
        me.state.selectedRoute = routeId;
        var route = me.getRouteById(routeId);
        if (!route) return;

        me.drawRoutePolylines(routeId, route.forward_points, route.backward_points);
        me.drawRouteStops(routeId, route);

        if (me.memoPanel) me.memoPanel.loadRoute(route);
        if (me.timelinePanel) me.timelinePanel.renderChart(me.getTimeline(routeId));

        me.updateRouteVehiclesGrid(routeId);
    },

    drawRoutePolylines: function (routeId, forwardPoints, backwardPoints) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        this.clearRoutePolylines(routeId);

        if (forwardPoints && forwardPoints.length > 1) {
            var latlngs = forwardPoints.map(function (p) { return [p.lat, p.lon || p.lng]; });
            var line = L.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: 0.85 }).addTo(map.map);
            this.state.mapLayers.routePolylines[routeId + '_forward'] = line;
        }
        if (backwardPoints && backwardPoints.length > 1) {
            var latlngs = backwardPoints.map(function (p) { return [p.lat, p.lon || p.lng]; });
            var line = L.polyline(latlngs, { color: '#dc2626', weight: 5, opacity: 0.85, dashArray: '8, 6' }).addTo(map.map);
            this.state.mapLayers.routePolylines[routeId + '_backward'] = line;
        }
    },

    drawRouteStops: function (routeId, route) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;
        me.clearRouteStops(routeId);

        var drawStops = function (stops, color, prefix) {
            stops.forEach(function (rs, index) {
                var icon = L.divIcon({
                    className: 'pt-route-stop-marker',
                    html: '<div class="pt-route-stop-number" style="background:' + color + '">' + (index + 1) + '</div>',
                    iconSize: [28, 28], iconAnchor: [14, 14]
                });
                var marker = L.marker([rs.lat, rs.lon], { icon: icon, title: rs.name }).addTo(map.map);
                marker.bindPopup('<b>' + Ext.String.htmlEncode(rs.name) + '</b><br/>' +
                                 (prefix === 'forward' ? l('Прямое направление') : l('Обратное направление')));
                marker.on('click', function () {
                    if (me.memoPanel) me.memoPanel.highlightStop(index);
                });
                if (!me.state.mapLayers.routeStops[routeId]) me.state.mapLayers.routeStops[routeId] = [];
                me.state.mapLayers.routeStops[routeId].push(marker);
            });
        };

        if (route.forward_stops) drawStops(route.forward_stops, '#2563eb', 'forward');
        if (route.backward_stops) drawStops(route.backward_stops, '#dc2626', 'backward');
    },

    clearRoutePolylines: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        ['forward', 'backward'].forEach(function (dir) {
            var key = routeId + '_' + dir;
            if (this.state.mapLayers.routePolylines[key]) {
                map.map.removeLayer(this.state.mapLayers.routePolylines[key]);
                delete this.state.mapLayers.routePolylines[key];
            }
        }.bind(this));
    },

    clearRouteStops: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        if (this.state.mapLayers.routeStops[routeId]) {
            this.state.mapLayers.routeStops[routeId].forEach(function (m) { map.map.removeLayer(m); });
            delete this.state.mapLayers.routeStops[routeId];
        }
    },

    // ==================== ПРИВЯЗКА ОСТАНОВОК К МАРШРУТУ ====================

    showRouteStopsBinding: function (routeId) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route) return;

        var win = Ext.create('Store.passenger_transit.view.RouteStopsBindingWindow', {
            module: me,
            route: route
        });
        win.show();
    },

    // ==================== ПОЛИЛИНИЯ МАРШРУТА (РИСОВАНИЕ) ====================

    enableRoutePolylineEdit: function (routeId, direction) {
        var me = this;
        me.state.routeEditMode = true;
        me.state.selectedRoute = routeId;
        me.state.editDirection = direction || 'forward';
        me.state.editingRoutePoints = [];

        var route = me.getRouteById(routeId);
        if (route) {
            var existing = direction === 'forward' ? route.forward_points : route.backward_points;
            if (existing && existing.length > 0) {
                me.state.editingRoutePoints = Ext.Array.clone(existing);
            }
        }

        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me._routeEditClickHandler = function (e) {
            if (!me.state.routeEditMode) return;
            me.state.editingRoutePoints.push({
                lat: e.latlng.lat,
                lon: e.latlng.lng,
                order_index: me.state.editingRoutePoints.length
            });
            me.drawEditingPolyline();
            me.updateEditToolbarStats();
        };

        me._routeEditRightClickHandler = function (e) {
            if (!me.state.routeEditMode) return;
            if (e.originalEvent) e.originalEvent.preventDefault();
            me.finishRoutePolylineEdit();
        };

        map.map.on('click', me._routeEditClickHandler);
        map.map.on('contextmenu', me._routeEditRightClickHandler);

        me.showRouteEditToolbar();
        Ext.toast({
            html: l('Кликайте для добавления точек. Правый клик — завершить.'),
            align: 't', timeout: 8000
        });
    },

    drawEditingPolyline: function () {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        if (me.state.mapLayers.editingPolyline) map.map.removeLayer(me.state.mapLayers.editingPolyline);

        var points = me.state.editingRoutePoints;
        if (points.length === 0) return;

        var latlngs = points.map(function (p) { return [p.lat, p.lon || p.lng]; });
        var color = me.state.editDirection === 'forward' ? '#2563eb' : '#dc2626';

        me.state.mapLayers.editingPolyline = L.polyline(latlngs, {
            color: color, weight: 5, opacity: 0.9
        }).addTo(map.map);
    },

    finishRoutePolylineEdit: function () {
        var me = this;
        if (!me.state.routeEditMode) return;
        var points = me.state.editingRoutePoints;

        if (points.length < 2) {
            Ext.Msg.alert(l('Ошибка'), l('Минимум 2 точки'));
            return;
        }

        Ext.Msg.confirm(
            l('Сохранение полилинии'),
            l('Точек: ') + points.length + '. ' + l('Сохранить?'),
            function (btn) {
                if (btn === 'yes') {
                    Ext.Ajax.request({
                        url: me.getBackendUrl('routes/' + me.state.selectedRoute + '/polylines'),
                        method: 'POST',
                        jsonData: {
                            direction: me.state.editDirection,
                            points: points
                        },
                        success: function () {
                            Ext.toast({ html: l('Полилиния сохранена'), align: 't', timeout: 2000 });
                            me.loadRoutes();
                        }
                    });
                }
                me.disableRoutePolylineEdit();
            }
        );
    },

    disableRoutePolylineEdit: function () {
        var me = this;
        me.state.routeEditMode = false;
        var map = me.getPilotMap();
        if (map && map.map) {
            if (me._routeEditClickHandler) map.map.off('click', me._routeEditClickHandler);
            if (me._routeEditRightClickHandler) map.map.off('contextmenu', me._routeEditRightClickHandler);
            if (me.state.mapLayers.editingPolyline) {
                map.map.removeLayer(me.state.mapLayers.editingPolyline);
                me.state.mapLayers.editingPolyline = null;
            }
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
                    { text: l('Завершить'), iconCls: 'fa fa-check', handler: me.finishRoutePolylineEdit, scope: me },
                    { text: l('Отмена'), iconCls: 'fa fa-times', handler: me.disableRoutePolylineEdit, scope: me },
                    '-',
                    {
                        text: l('Удалить последнюю'), iconCls: 'fa fa-undo',
                        handler: function () {
                            me.state.editingRoutePoints.pop();
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
        if (!this.editToolbar) return;
        var count = this.state.editingRoutePoints.length;
        var textItem = this.editToolbar.down('tbtext');
        if (textItem) textItem.setText(l('Точек: ') + count);
    },

    // ==================== ТС МАРШРУТА ====================

    updateRouteVehiclesGrid: function (routeId) {
        var me = this;
        if (!me.vehiclesGrid) return;
        me.vehiclesGrid.getStore().removeAll();
        if (!routeId) return;

        Ext.Ajax.request({
            url: me.getBackendUrl('vehicles/' + routeId),
            method: 'GET',
            async: false,
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    var gridData = (data.vehicles || []).map(function (v) {
                        var pilotVeh = me.state.pilotVehicles.find(function (pv) { return pv.id == v.vehicle_id; });
                        return {
                            vehicle_id: v.vehicle_id,
                            vehicle_number: v.vehicle_number || (pilotVeh ? pilotVeh.number : 'N/A'),
                            direction: 'forward',
                            trips_count: 0,
                            online: pilotVeh ? pilotVeh.online : false,
                            lat: pilotVeh ? pilotVeh.lat : 0,
                            lon: pilotVeh ? pilotVeh.lon : 0
                        };
                    });
                    me.vehiclesGrid.getStore().loadData(gridData);
                }
            }
        });
    },

    getRouteVehicles: function (routeId) {
        var vehicles = [];
        Ext.Ajax.request({
            url: this.getBackendUrl('vehicles/' + routeId),
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

    showVehicleBindingDialog: function (routeId) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route) return;
        var boundVehicles = me.getRouteVehicles(routeId);

        var pilotStore = Ext.create('Ext.data.Store', {
            fields: ['id', 'name', 'number', 'group', 'online'],
            data: me.state.pilotVehicles,
            filters: [function (item) {
                return !boundVehicles.some(function (bv) { return String(bv.vehicle_id) === String(item.data.id); });
            }]
        });

        var boundStore = Ext.create('Ext.data.Store', {
            fields: ['id', 'vehicle_id', 'vehicle_number'],
            data: boundVehicles.map(function (v) {
                return { id: v.id, vehicle_id: v.vehicle_id, vehicle_number: v.vehicle_number };
            })
        });

        var win = Ext.create('Ext.window.Window', {
            title: l('Привязка ТС') + ' - ' + route.name,
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
                        selModel: { selType: 'checkboxmodel' },
                        tbar: [{
                            xtype: 'textfield', emptyText: l('Поиск...'), enableKeyEvents: true,
                            listeners: {
                                keyup: function (f) {
                                    pilotStore.clearFilter();
                                    pilotStore.filterBy(function (r) {
                                        return r.get('number').toLowerCase().indexOf(f.getValue().toLowerCase()) !== -1;
                                    });
                                }
                            }
                        }]
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
                                    pilotStore.reload();
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
                        setTimeout(function () {
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

    getTimeline: function (routeId) {
        var timeline = { hours: [], trips: [] };
        Ext.Ajax.request({
            url: this.getBackendUrl('trips/timeline'),
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

    // ==================== УТИЛИТЫ ====================

    getPilotMap: function () {
        if (window.getActiveTabMapContainer) return getActiveTabMapContainer();
        return window.mapContainer || null;
    },

    getRouteById: function (routeId) {
        var found = null;
        Ext.each(this.state.routes, function (r) {
            if (r.id == routeId) { found = r; return false; }
        });
        return found;
    },

    refreshRouteTree: function () {
        var me = this;
        // ИСПОЛЬЗУЕМ СОХРАНЕННУЮ ССЫЛКУ НА ДЕРЕВО
        if (me.routeTree) {
            me.routeTree.loadRoutes(me.state.routes);
        }
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
        me.store = Ext.create('Ext.data.TreeStore', { root: { expanded: true, children: [] } });

        me.tbar = [
            {
                text: l('Маршрут'), iconCls: 'fa fa-plus',
                tooltip: l('Создать новый маршрут'),
                handler: me.onAddRoute, scope: me
            },
            {
                text: l('Остановки'), iconCls: 'fa fa-map-marker',
                tooltip: l('Справочник остановок (геозоны)'),
                handler: function () { if (me.module) me.module.showStopsCatalogWindow(); },
                scope: me
            },
            '-',
            {
                text: l('Состав'), iconCls: 'fa fa-list-ol',
                tooltip: l('Привязать остановки из справочника'),
                handler: function () {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) me.module.showRouteStopsBinding(rec.data.route_id);
                    else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
                },
                scope: me
            },
            {
                text: l('Трасса'), iconCls: 'fa fa-pencil',
                tooltip: l('Нарисовать полилинию маршрута'),
                handler: function () {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) me.module.enableRoutePolylineEdit(rec.data.route_id, 'forward');
                    else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
                },
                scope: me
            },
            {
                text: l('ТС'), iconCls: 'fa fa-link',
                tooltip: l('Привязать ТС к маршруту'),
                handler: function () {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) me.module.showVehicleBindingDialog(rec.data.route_id);
                    else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
                },
                scope: me
            }
        ];

        me.columns = [
            { xtype: 'treecolumn', text: l('Маршрут'), dataIndex: 'name', flex: 1 },
            { text: l('Ост.'), dataIndex: 'stop_count', width: 45, align: 'center', tooltip: l('Остановок в маршруте') },
            { text: l('ТС'), dataIndex: 'vehicle_count', width: 45, align: 'center', tooltip: l('Привязанных ТС') }
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
                route_id: r.id, leaf: true, iconCls: 'fa fa-route'
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
            l('Новый маршрут'), l('Название маршрута') + ':',
            function (btn, text) {
                if (btn === 'ok') {
                    var name = text ? String(text).trim() : '';
                    if (name.length < 2) {
                        Ext.Msg.alert(l('Ошибка'), l('Минимум 2 символа'));
                        return;
                    }
                    Ext.Ajax.request({
                        url: me.module.getBackendUrl('routes'),
                        method: 'POST',
                        jsonData: { name: name },
                        success: function (resp) {
                            var data = Ext.decode(resp.responseText);
                            if (data.success) {
                                Ext.toast({
                                    html: l('Маршрут "') + name + l('" создан'),
                                    align: 't', timeout: 3000
                                });
                                me.module.loadRoutes();
                            } else {
                                Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось создать'));
                            }
                        },
                        failure: function (resp) {
                            Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения с сервером'));
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
                renderer: function (value, meta, record) {
                    var online = record.get('online');
                    var color = online ? '#16a34a' : '#94a3b8';
                    var dot = online
                        ? '<span style="color:#16a34a;font-size:10px">●</span> '
                        : '<span style="color:#cbd5e1;font-size:10px">●</span> ';
                    return '<span style="font-weight:600;color:' + color + '">' + dot + Ext.String.htmlEncode(value || 'N/A') + '</span>';
                }
            },
            {
                text: l('Напр.'), dataIndex: 'direction', width: 60, align: 'center',
                renderer: function (value) {
                    if (value === 'forward') return '<div class="pt-direction-badge pt-direction-forward"><i class="fa fa-long-arrow-right"></i></div>';
                    if (value === 'backward') return '<div class="pt-direction-badge pt-direction-backward"><i class="fa fa-long-arrow-left"></i></div>';
                    return '<span style="color:#94a3b8">—</span>';
                }
            },
            {
                text: l('Рейсов'), dataIndex: 'trips_count', width: 65, align: 'center',
                renderer: function (value) {
                    var num = parseInt(value) || 0;
                    var color = num > 5 ? '#16a34a' : (num > 0 ? '#f59e0b' : '#cbd5e1');
                    return '<span style="font-weight:700;color:' + color + '">' + num + '</span>';
                }
            }
        ];

        me.emptyText = '<div class="pt-vehicles-empty"><i class="fa fa-bus" style="font-size:32px;color:#cbd5e1"></i><div style="margin-top:8px;color:#94a3b8;font-size:12px">' + l('Выберите маршрут') + '</div></div>';
        me.viewConfig = {
            stripeRows: true,
            getRowClass: function (record) {
                return record.get('online') ? 'pt-vehicle-row-online' : 'pt-vehicle-row-offline';
            }
        };
        me.selModel = Ext.create('Ext.selection.RowModel', { mode: 'SINGLE' });
        me.callParent(arguments);
    }
});


// ============================================================================
// VIEW: AddStopWindow - модальное окно добавления новой остановки
// ============================================================================
Ext.define('Store.passenger_transit.view.AddStopWindow', {
    extend: 'Ext.window.Window',
    cls: 'pt-addstop-window',
    modal: true,
    width: 460,
    closable: true,
    resizable: false,
    closeAction: 'destroy',
    title: '<i class="fa fa-map-marker"></i> ' + l('Новая остановка'),

    initComponent: function () {
        var me = this;
        var coords = me.coords || { lat: 0, lon: 0 };

        me.items = [{
            xtype: 'form',
            itemId: 'stopForm',
            bodyPadding: 16,
            border: false,
            defaults: { labelWidth: 110, anchor: '100%', msgTarget: 'side' },
            items: [
                {
                    xtype: 'textfield',
                    name: 'name',
                    itemId: 'stopName',
                    fieldLabel: l('Название') + ':',
                    emptyText: l('Например: пл. Ленина'),
                    allowBlank: false,
                    minLength: 2, maxLength: 100,
                    listeners: {
                        afterrender: function (f) { setTimeout(function () { f.focus(true, 100); }, 100); },
                        specialkey: function (f, e) { if (e.getKey() === e.ENTER) me.onSaveClick(); }
                    }
                },
                {
                    xtype: 'fieldcontainer',
                    fieldLabel: l('Координаты') + ':',
                    layout: 'hbox',
                    defaults: { flex: 1, labelWidth: 30, decimalPrecision: 6, allowDecimals: true, allowBlank: false },
                    items: [
                        { xtype: 'numberfield', name: 'lat', itemId: 'stopLat', fieldLabel: l('Шир'), value: coords.lat, minValue: -90, maxValue: 90, readOnly: true },
                        { xtype: 'numberfield', name: 'lon', itemId: 'stopLon', fieldLabel: l('Дол'), value: coords.lon, margin: '0 0 0 8', readOnly: true }
                    ]
                },
                {
                    xtype: 'numberfield',
                    name: 'radius',
                    itemId: 'stopRadius',
                    fieldLabel: l('Радиус (м)') + ':',
                    value: 30,
                    minValue: 5,
                    maxValue: 5000,
                    listeners: {
                        change: function (f, newVal) {
                            me.fireEvent('radiuschange', me, newVal);
                        }
                    }
                },
                {
                    xtype: 'textarea',
                    name: 'description',
                    fieldLabel: l('Описание') + ':',
                    emptyText: l('Необязательно'),
                    maxLength: 255, height: 50, grow: true, growMin: 40, growMax: 100
                },
                {
                    xtype: 'container',
                    cls: 'pt-addstop-hint',
                    html: '<i class="fa fa-info-circle"></i> ' + l('Радиус можно менять в этом поле. Координаты — из клика по карте.')
                }
            ]
        }];

        me.buttons = [
            { text: l('Сохранить'), iconCls: 'fa fa-check', cls: 'pt-btn-primary', handler: me.onSaveClick, scope: me },
            { text: l('Отмена'), iconCls: 'fa fa-times', handler: me.onCancelClick, scope: me }
        ];

        me.callParent(arguments);
    },

    onSaveClick: function () {
        var me = this;
        var form = me.down('#stopForm').getForm();
        if (!form.isValid()) {
            Ext.toast({ html: l('Заполните все поля'), align: 't', timeout: 2000 });
            return;
        }
        var values = form.getValues();
        var name = String(values.name).trim();
        if (name.length < 2) {
            Ext.Msg.alert(l('Ошибка'), l('Минимум 2 символа'));
            return;
        }
        me.fireEvent('save', me, {
            name: name,
            lat: parseFloat(values.lat),
            lon: parseFloat(values.lon),
            radius: parseFloat(values.radius) || 30,
            description: values.description ? String(values.description).trim() : ''
        });
        me.close();
    },

    onCancelClick: function () {
        this.fireEvent('cancel', this);
        this.close();
    }
});


// ============================================================================
// VIEW: StopsCatalogWindow - модальное окно справочника остановок
// ============================================================================
Ext.define('Store.passenger_transit.view.StopsCatalogWindow', {
    extend: 'Ext.window.Window',
    cls: 'pt-stops-catalog-window',
    modal: false,
    width: 650,
    height: 500,
    title: '<i class="fa fa-map-marker"></i> ' + l('Справочник остановок'),
    layout: 'fit',
    closeAction: 'hide',

    initComponent: function () {
        var me = this;

        me.store = Ext.create('Ext.data.Store', {
            fields: ['id', 'name', 'lat', 'lon', 'radius', 'description']
        });

        me.items = [{
            xtype: 'grid',
            store: me.store,
            itemId: 'stopsGrid',
            columns: [
                { text: l('Название'), dataIndex: 'name', flex: 2,
                  renderer: function (v) { return '<b>' + Ext.String.htmlEncode(v) + '</b>'; }
                },
                { text: l('Радиус (м)'), dataIndex: 'radius', width: 90, align: 'center' },
                { text: l('Широта'), dataIndex: 'lat', width: 100, align: 'center',
                  renderer: function (v) { return parseFloat(v).toFixed(5); }
                },
                { text: l('Долгота'), dataIndex: 'lon', width: 100, align: 'center',
                  renderer: function (v) { return parseFloat(v).toFixed(5); }
                },
                {
                    text: l('Действия'), width: 100, align: 'center', sortable: false,
                    renderer: function (v, m, r) {
                        return '<button class="pt-grid-btn pt-grid-btn-edit" data-id="' + r.get('id') + '" title="' + l('Редактировать') + '"><i class="fa fa-edit"></i></button>' +
                               '<button class="pt-grid-btn pt-grid-btn-delete" data-id="' + r.get('id') + '" title="' + l('Удалить') + '"><i class="fa fa-trash"></i></button>';
                    }
                }
            ],
            tbar: [
                {
                    text: l('Добавить остановку'), iconCls: 'fa fa-plus',
                    cls: 'pt-btn-primary',
                    handler: function () {
                        me.hide();
                        me.module.enableAddStopMode();
                    }
                },
                '-',
                {
                    xtype: 'textfield',
                    emptyText: l('Поиск по названию...'),
                    width: 200,
                    enableKeyEvents: true,
                    listeners: {
                        keyup: function (f) {
                            me.store.clearFilter();
                            var val = f.getValue().toLowerCase();
                            if (val) {
                                me.store.filterBy(function (r) {
                                    return r.get('name').toLowerCase().indexOf(val) !== -1;
                                });
                            }
                        }
                    }
                }
            ],
            viewConfig: { stripeRows: true },
            listeners: {
                afterrender: function (grid) {
                    grid.getEl().on('click', function (e, target) {
                        var btn = e.getTarget('.pt-grid-btn');
                        if (!btn) return;
                        var id = parseInt(btn.getAttribute('data-id'));
                        if (btn.classList.contains('pt-grid-btn-edit')) {
                            me.hide();
                            me.module.enableStopEditMode(id);
                        } else if (btn.classList.contains('pt-grid-btn-delete')) {
                            var rec = me.store.findRecord('id', id);
                            if (rec) me.module.confirmDeleteStop(id, rec.get('name'));
                        }
                    });
                }
            }
        }];

        me.callParent(arguments);
    },

    loadStops: function (stops) {
        this.store.loadData(stops || []);
    }
});


// ============================================================================
// VIEW: RouteStopsBindingWindow - привязка остановок из справочника к маршруту
// ============================================================================
Ext.define('Store.passenger_transit.view.RouteStopsBindingWindow', {
    extend: 'Ext.window.Window',
    cls: 'pt-route-stops-binding-window',
    modal: true,
    width: 900,
    height: 550,
    title: l('Состав маршрута'),
    layout: 'border',
    closeAction: 'destroy',

    initComponent: function () {
        var me = this;
        var route = me.route;

        me.setTitle(l('Состав маршрута') + ': ' + route.name);

        // Все остановки справочника
        me.catalogStore = Ext.create('Ext.data.Store', {
            fields: ['id', 'name', 'lat', 'lon', 'radius'],
            data: me.module.state.stopsCatalog
        });

        // Выбранные остановки маршрута
        me.selectedStore = Ext.create('Ext.data.Store', {
            fields: ['stop_id', 'name', 'lat', 'lon', 'direction', 'order_index']
        });

        // Загружаем текущие остановки маршрута
        if (route.stops && route.stops.length > 0) {
            me.selectedStore.loadData(route.stops.map(function (s, idx) {
                return {
                    stop_id: s.stop_id,
                    name: s.name,
                    lat: s.lat,
                    lon: s.lon,
                    direction: s.direction,
                    order_index: s.order_index
                };
            }));
        }

        me.items = [
            {
                region: 'west',
                title: l('Справочник остановок'),
                width: 380,
                split: true,
                layout: 'fit',
                items: [{
                    xtype: 'grid',
                    itemId: 'catalogGrid',
                    store: me.catalogStore,
                    selModel: { selType: 'checkboxmodel' },
                    columns: [
                        { text: l('Название'), dataIndex: 'name', flex: 1 },
                        { text: l('Радиус'), dataIndex: 'radius', width: 70, align: 'center' }
                    ],
                    tbar: [{
                        xtype: 'textfield',
                        emptyText: l('Поиск...'),
                        enableKeyEvents: true,
                        listeners: {
                            keyup: function (f) {
                                me.catalogStore.clearFilter();
                                var val = f.getValue().toLowerCase();
                                if (val) {
                                    me.catalogStore.filterBy(function (r) {
                                        return r.get('name').toLowerCase().indexOf(val) !== -1;
                                    });
                                }
                            }
                        }
                    }]
                }]
            },
            {
                region: 'center',
                title: l('Остановки маршрута'),
                layout: 'fit',
                items: [{
                    xtype: 'grid',
                    itemId: 'selectedGrid',
                    store: me.selectedStore,
                    columns: [
                        { text: l('№'), dataIndex: 'order_index', width: 40, align: 'center',
                          renderer: function (v, m, r) { return r.index + 1; }
                        },
                        { text: l('Название'), dataIndex: 'name', flex: 1 },
                        {
                            text: l('Направление'), dataIndex: 'direction', width: 110, align: 'center',
                            renderer: function (v, m, r) {
                                var dir = v || 'forward';
                                return '<select class="pt-direction-select" data-row-index="' + r.index + '">' +
                                       '<option value="forward"' + (dir === 'forward' ? ' selected' : '') + '>' + l('Прямое') + ' →</option>' +
                                       '<option value="backward"' + (dir === 'backward' ? ' selected' : '') + '>' + l('Обратное') + ' ←</option>' +
                                       '</select>';
                            }
                        },
                        {
                            text: '', width: 40, align: 'center', sortable: false,
                            renderer: function (v, m, r) {
                                return '<button class="pt-grid-btn pt-grid-btn-up" data-idx="' + r.index + '" title="' + l('Вверх') + '"><i class="fa fa-arrow-up"></i></button>' +
                                       '<button class="pt-grid-btn pt-grid-btn-down" data-idx="' + r.index + '" title="' + l('Вниз') + '"><i class="fa fa-arrow-down"></i></button>';
                            }
                        },
                        {
                            text: '', width: 40, align: 'center', sortable: false,
                            renderer: function (v, m, r) {
                                return '<button class="pt-grid-btn pt-grid-btn-delete" data-idx="' + r.index + '" title="' + l('Удалить') + '"><i class="fa fa-times"></i></button>';
                            }
                        }
                    ],
                    listeners: {
                        afterrender: function (grid) {
                            grid.getEl().on('click', function (e, target) {
                                var btn = e.getTarget('.pt-grid-btn');
                                if (!btn) return;
                                var idx = parseInt(btn.getAttribute('data-idx'));
                                if (btn.classList.contains('pt-grid-btn-delete')) {
                                    me.selectedStore.removeAt(idx);
                                } else if (btn.classList.contains('pt-grid-btn-up') && idx > 0) {
                                    var data = me.selectedStore.getAt(idx).data;
                                    me.selectedStore.removeAt(idx);
                                    me.selectedStore.insert(idx - 1, data);
                                } else if (btn.classList.contains('pt-grid-btn-down') && idx < me.selectedStore.getCount() - 1) {
                                    var data = me.selectedStore.getAt(idx).data;
                                    me.selectedStore.removeAt(idx);
                                    me.selectedStore.insert(idx + 1, data);
                                }
                            });
                            grid.getEl().on('change', function (e, target) {
                                if (target.classList.contains('pt-direction-select')) {
                                    var idx = parseInt(target.getAttribute('data-row-index'));
                                    var rec = me.selectedStore.getAt(idx);
                                    if (rec) rec.set('direction', target.value);
                                }
                            });
                        }
                    }
                }]
            }
        ];

        me.buttons = [
            {
                text: l('Добавить выбранные →'), iconCls: 'fa fa-plus',
                handler: function () {
                    var catalogGrid = me.down('#catalogGrid');
                    var sel = catalogGrid.getSelectionModel().getSelection();
                    if (sel.length === 0) {
                        Ext.Msg.alert(l('Внимание'), l('Выберите остановки в справочнике'));
                        return;
                    }
                    Ext.each(sel, function (r) {
                        var exists = me.selectedStore.findExact('stop_id', r.get('id'));
                        if (exists === -1) {
                            me.selectedStore.add({
                                stop_id: r.get('id'),
                                name: r.get('name'),
                                lat: r.get('lat'),
                                lon: r.get('lon'),
                                direction: 'forward',
                                order_index: me.selectedStore.getCount()
                            });
                        }
                    });
                    catalogGrid.getSelectionModel().deselectAll();
                }
            },
            '-',
            {
                text: l('Сохранить'), iconCls: 'fa fa-check', cls: 'pt-btn-primary',
                handler: function () {
                    var stops = [];
                    me.selectedStore.each(function (rec, idx) {
                        stops.push({
                            stop_id: rec.get('stop_id'),
                            direction: rec.get('direction') || 'forward',
                            order_index: idx
                        });
                    });
                    Ext.Ajax.request({
                        url: me.module.getBackendUrl('routes/' + route.id + '/stops'),
                        method: 'POST',
                        jsonData: { stops: stops },
                        success: function (resp) {
                            var data = Ext.decode(resp.responseText);
                            if (data.success) {
                                Ext.toast({ html: l('Состав маршрута сохранён'), align: 't', timeout: 2000 });
                                me.module.loadRoutes();
                                me.close();
                            } else {
                                Ext.Msg.alert(l('Ошибка'), data.error);
                            }
                        }
                    });
                }
            },
            { text: l('Закрыть'), handler: function () { me.close(); } }
        ];

        me.callParent(arguments);
    }
});


// ============================================================================
// VIEW: RouteMemoPanel
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
        var stops = direction === 'forward' ? route.forward_stops : route.backward_stops;
        if (!stops || stops.length === 0) {
            return '<div class="pt-memo-empty">' + l('Нет остановок') + '</div>';
        }
        var html = '<div class="pt-memo-route">';
        html += '<div class="pt-memo-header">' + Ext.String.htmlEncode(route.name) + '</div>';
        html += '<div class="pt-memo-stops">';
        stops.forEach(function (stop, index) {
            var number = direction === 'forward' ? (index + 1) : (stops.length - index);
            html += '<div class="pt-memo-stop pt-stop-' + direction + '" data-index="' + index + '">';
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
// VIEW: TimelinePanel
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
