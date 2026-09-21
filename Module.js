// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки
// Справочник остановок + RFID метки + Маршруты

Ext.define('Store.passenger_transit.Module', {
    extend: 'Ext.Component',
    extensionName: 'passenger_transit',

    backendBaseUrl: 'https://saggy-return-aide.ngrok-free.dev',

    getBackendUrl: function(action) {
        return this.backendBaseUrl + '/api/' + action;
    },

    state: {
        currentPanel: 'routes',   // 'routes' | 'stops' | 'stop-edit'
        stopsCatalog: [],
        rfidTags: [],             // НОВОЕ: справочник RFID
        routes: [],
        selectedRoute: null,
        selectedVehicle: null,
        mapLayers: {
            routes: {},
            stopsCatalog: {},
            routeStops: {},
            vehicles: {},
            tracks: {},
            editingPolyline: null,
            editingPoints: [],
            editingStopZone: null
        },
        editMode: false,
        addStopMode: false,
        routeEditMode: false,
        editDirection: 'forward',
        editingStop: null,        // НОВОЕ: редактируемая остановка (null = создание)
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

        // Обход Ngrok
        Ext.Ajax.on('beforerequest', function(conn, options) {
            options.headers = options.headers || {};
            options.headers['ngrok-skip-browser-warning'] = 'true';
        });

        // CSS
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
        me.routeTree = Ext.create('Store.passenger_transit.view.RouteTree', { module: me });
        me.stopsCatalogPanel = Ext.create('Store.passenger_transit.view.StopsCatalogPanel', { module: me });
        me.stopEditPanel = Ext.create('Store.passenger_transit.view.StopEditPanel', { module: me });

        // Контейнер с card-переключением
        me.leftContent = Ext.create('Ext.panel.Panel', {
            layout: 'card',
            border: false,
            bodyBorder: false,
            activeItem: 0,
            items: [me.routeTree, me.stopsCatalogPanel, me.stopEditPanel]
        });

        // Тулбар-переключатель
        me.panelSwitcher = Ext.create('Ext.toolbar.Toolbar', {
            dock: 'top',
            cls: 'pt-panel-switcher',
            items: [
                {
                    text: l('Маршруты'),
                    iconCls: 'fa fa-route',
                    itemId: 'btnRoutes',
                    enableToggle: true,
                    toggleGroup: 'panelSwitch',
                    pressed: true,
                    flex: 1,
                    handler: function() { me.switchPanel('routes'); }
                },
                {
                    text: l('Остановки'),
                    iconCls: 'fa fa-map-marker',
                    itemId: 'btnStops',
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

        me.navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 400,
            layout: 'fit',
            items: [me.navContainer]
        });

        me.navTab.map_frame = null;

        if (window.skeleton && skeleton.navigation && skeleton.mapframe) {
            skeleton.navigation.add(me.navTab);

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

            if (skeleton.navigation.on) {
                skeleton.navigation.on('tabchange', function(tabPanel, newTab) {
                    if (newTab === me.navTab) me.onTabActivated();
                    else me.onTabDeactivated();
                });
            }

            me.loadStopsCatalog();
            me.loadRfidTags();
            me.loadRoutes();
            me.loadVehiclesFromPilot();

            setTimeout(function() {
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
    },

    onTabDeactivated: function() {
        this.state.isTabActive = false;
    },

    // ==================== PILOT API ====================

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

    // ========================================================================
    // RFID МЕТКИ (НОВОЕ)
    // ========================================================================

    loadRfidTags: function () {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('rfid-tags'),
            method: 'GET',
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    me.state.rfidTags = data.tags || [];
                }
            },
            failure: function () {
                Ext.log('passenger_transit: failed to load RFID tags');
            }
        });
    },

    getRfidTagById: function(tagId) {
        if (!tagId) return null;
        return this.state.rfidTags.find(function(t) { return t.id === tagId; }) || null;
    },

    // ========================================================================
    // СПРАВОЧНИК ОСТАНОВОК
    // ========================================================================

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
                    me.drawAllCatalogStops();
                }
            },
            failure: function () {
                Ext.log('passenger_transit: failed to load stops catalog');
            }
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
                    Ext.toast({ html: l('Остановка добавлена в справочник'), align: 't', timeout: 2500 });
                    me.loadStopsCatalog();
                    me.switchPanel('stops');
                } else {
                    Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось добавить'));
                }
            },
            failure: function () {
                Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения с сервером'));
            }
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
            failure: function () {
                Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения с сервером'));
            }
        });
    },

    deleteStopFromCatalog: function(stopId) {
        var me = this;
        Ext.Msg.confirm(
            l('Удаление остановки'),
            l('Вы уверены, что хотите удалить остановку из справочника?'),
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
    // ОТОБРАЖЕНИЕ ГЕОЗОН НА КАРТЕ
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

    drawCatalogStop: function(stop) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        var circle = L.circle([stop.lat, stop.lon], {
            radius: stop.radius || 30,
            color: '#94a3b8',
            fillColor: '#cbd5e1',
            fillOpacity: 0.3,
            weight: 2,
            className: 'pt-catalog-stop-zone'
        }).addTo(map.map);

        var label = L.marker([stop.lat, stop.lon], {
            icon: L.divIcon({
                className: 'pt-catalog-stop-label',
                html: '<div class="pt-catalog-stop-label-inner">' +
                      '<i class="fa fa-map-marker"></i> ' +
                      '<span>' + Ext.String.htmlEncode(stop.name) + '</span>' +
                      (stop.rfid_code ? ' <i class="fa fa-microchip pt-rfid-mini-icon" title="RFID: ' + Ext.String.htmlEncode(stop.rfid_code) + '"></i>' : '') +
                      '</div>',
                iconSize: [0, 0],
                iconAnchor: [0, -25]
            }),
            interactive: false
        }).addTo(map.map);

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

        circle.bindPopup(popupHtml);

        circle.on('dblclick', function(e) {
            L.DomEvent.stopPropagation(e);
            me.showEditStop(stop);
        });

        me.state.mapLayers.stopsCatalog[stop.id] = {
            circle: circle,
            label: label,
            data: stop
        };
    },

    clearAllCatalogStops: function() {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        Object.keys(me.state.mapLayers.stopsCatalog).forEach(function(key) {
            var layer = me.state.mapLayers.stopsCatalog[key];
            if (layer.circle) map.map.removeLayer(layer.circle);
            if (layer.label) map.map.removeLayer(layer.label);
        });
        me.state.mapLayers.stopsCatalog = {};
    },

    refreshStopsCatalogPanel: function() {
        if (this.stopsCatalogPanel) {
            this.stopsCatalogPanel.loadStops(this.state.stopsCatalog);
        }
    },

    // ========================================================================
    // РЕЖИМ ДОБАВЛЕНИЯ/РЕДАКТИРОВАНИЯ ОСТАНОВКИ
    // ========================================================================

    enterAddStopMode: function() {
        var me = this;
        if (me.state.addStopMode) return;

        me.state.addStopMode = true;
        me.state.editingStop = null; // режим создания

        // Переключаемся на панель редактирования
        me.switchPanel('stop-edit');
        me.stopEditPanel.resetForm();
        me.stopEditPanel.setMode('create');

        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me._addStopClickHandler = function(e) {
            if (!me.state.addStopMode) return;
            // Обновляем координаты в форме
            me.stopEditPanel.setCoords(e.latlng.lat, e.latlng.lng);

            // Создаем предпросмотр геозоны, если её нет
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

    showEditStop: function(stop) {
        var me = this;
        me.state.editingStop = stop;
        me.exitAddStopMode();

        me.switchPanel('stop-edit');
        me.stopEditPanel.setMode('edit');
        me.stopEditPanel.loadStopData(stop);

        me._createEditingZone(stop.lat, stop.lon, stop.radius || 30);
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

    // ========================================================================
    // СОХРАНЕНИЕ ОСТАНОВКИ ИЗ ПАНЕЛИ РЕДАКТИРОВАНИЯ
    // ========================================================================

    saveStopFromPanel: function(data) {
        var me = this;
        var zone = me.state.mapLayers.editingStopZone;

        // Берем актуальные координаты и радиус с геозоны на карте
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
        me.state.editingStop = null;
        me.exitAddStopMode();
        me.switchPanel('stops');
    },

    // ========================================================================
    // МОДАЛЬНОЕ ОКНО ВЫБОРА RFID МЕТКИ
    // ========================================================================

    showRfidSelectWindow: function(currentTagId, callback) {
        var me = this;

        // Перезагружаем RFID метки перед открытием
        Ext.Ajax.request({
            url: me.getBackendUrl('rfid-tags'),
            method: 'GET',
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    me.state.rfidTags = data.tags || [];
                }

                var win = Ext.create('Store.passenger_transit.view.RfidSelectWindow', {
                    module: me,
                    currentTagId: currentTagId,
                    listeners: {
                        select: function(w, tag) {
                            if (callback) callback(tag);
                        },
                        clear: function() {
                            if (callback) callback(null);
                        },
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
                                        // Обновляем грид в окне выбора
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
            failure: function () {
                Ext.log('passenger_transit: failed to load routes from backend');
            }
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
        if (this.routeTree) {
            this.routeTree.loadRoutes(this.state.routes);
        }
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
    },

    drawRouteStops: function(routeId, stops) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        stops.forEach(function(stop, index) {
            var color = stop.direction === 'forward' ? '#2563eb' : '#dc2626';
            var circle = L.circle([stop.lat, stop.lon], {
                radius: stop.radius || 30,
                color: color,
                fillColor: color,
                fillOpacity: 0.25,
                weight: 3
            }).addTo(map.map);

            var label = L.marker([stop.lat, stop.lon], {
                icon: L.divIcon({
                    className: 'pt-route-stop-label',
                    html: '<div class="pt-route-stop-label-inner" style="background:' + color + '">' +
                          (index + 1) + '</div>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                })
            }).addTo(map.map);

            var popupHtml = '<b>' + Ext.String.htmlEncode(stop.name) + '</b><br/>' +
                '<small>' + (stop.direction === 'forward' ? l('Прямое') : l('Обратное')) + ' направление</small>';
            if (stop.rfid_code) {
                popupHtml += '<br/><small><i class="fa fa-microchip"></i> RFID: <b>' + Ext.String.htmlEncode(stop.rfid_code) + '</b></small>';
            }
            label.bindPopup(popupHtml);

            if (!me.state.mapLayers.routeStops[routeId]) {
                me.state.mapLayers.routeStops[routeId] = [];
            }
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

    getPilotMap: function () {
        if (window.getActiveTabMapContainer) return getActiveTabMapContainer();
        return window.mapContainer || null;
    }
});


// ============================================================================
// VIEW: RouteTree
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
            { text: l('Добавить'), iconCls: 'fa fa-plus', handler: me.onAddRoute, scope: me, tooltip: l('Создать маршрут') }
        ];

        me.columns = [
            { xtype: 'treecolumn', text: l('Маршрут'), dataIndex: 'name', flex: 1 },
            { text: l('Ост.'), dataIndex: 'stop_count', width: 45, align: 'center' }
        ];

        me.listeners = { itemclick: me.onRouteClick, scope: me };
        me.callParent(arguments);
    },

    loadRoutes: function (routes) {
        var me = this;
        var children = routes.map(function (r) {
            return {
                text: r.name, name: r.name,
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
// VIEW: StopsCatalogPanel
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
                text: l('Название'),
                dataIndex: 'name',
                flex: 1.5,
                renderer: function(v, m, r) {
                    var id = r.get('identifier');
                    var idHtml = id ? '<div style="color:#94a3b8;font-size:10px;font-weight:400">ID: ' + Ext.String.htmlEncode(id) + '</div>' : '';
                    return '<span style="font-weight:600"><i class="fa fa-map-marker" style="color:#f59e0b;margin-right:4px"></i>' +
                           Ext.String.htmlEncode(v) + '</span>' + idHtml;
                }
            },
            {
                text: 'RFID',
                dataIndex: 'rfid_code',
                width: 80,
                align: 'center',
                renderer: function(v) {
                    if (!v) return '<span style="color:#cbd5e1">—</span>';
                    return '<span style="color:#7c3aed;font-weight:600;font-size:11px" title="' + Ext.String.htmlEncode(v) + '">' +
                           '<i class="fa fa-microchip"></i> ' + Ext.String.htmlEncode(v.substring(0, 8)) +
                           (v.length > 8 ? '...' : '') + '</span>';
                }
            },
            {
                text: l('R'),
                dataIndex: 'radius',
                width: 50,
                align: 'center',
                renderer: function(v) {
                    return '<span style="color:#64748b;font-size:11px">' + (v || 30) + '</span>';
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
                    if (stop) me.module.showEditStop(stop);
                }
            },
            itemdblclick: function(view, record) {
                var map = me.module.getPilotMap();
                if (map && map.map) {
                    map.map.setView([record.get('lat'), record.get('lon')], 17);
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
// НОВОЕ: VIEW: StopEditPanel — ПАНЕЛЬ РЕДАКТИРОВАНИЯ ОСТАНОВКИ (СЛЕВА)
// ============================================================================
Ext.define('Store.passenger_transit.view.StopEditPanel', {
    extend: 'Ext.panel.Panel',
    cls: 'pt-stop-edit-panel',
    layout: 'fit',
    autoScroll: true,

    initComponent: function () {
        var me = this;

        me.currentMode = 'create'; // 'create' | 'edit'
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
                    name: 'name',
                    itemId: 'stopName',
                    fieldLabel: l('Название') + ':',
                    emptyText: l('Например: пл. Ленина'),
                    allowBlank: false,
                    minLength: 2,
                    maxLength: 100
                },
                {
                    xtype: 'textfield',
                    name: 'identifier',
                    itemId: 'stopIdentifier',
                    fieldLabel: l('Идентификатор') + ':',
                    emptyText: l('Уникальный код остановки'),
                    maxLength: 50
                },
                {
                    xtype: 'textarea',
                    name: 'description',
                    itemId: 'stopDescription',
                    fieldLabel: l('Описание') + ':',
                    emptyText: l('Необязательное описание'),
                    maxLength: 255,
                    height: 55,
                    grow: true,
                    growMin: 40,
                    growMax: 100
                },
                {
                    xtype: 'fieldcontainer',
                    fieldLabel: l('Координаты') + ':',
                    layout: 'hbox',
                    defaults: {
                        flex: 1,
                        labelWidth: 25,
                        decimalPrecision: 6,
                        allowDecimals: true,
                        allowBlank: false
                    },
                    items: [
                        {
                            xtype: 'numberfield',
                            name: 'lat',
                            itemId: 'stopLat',
                            fieldLabel: l('Шир'),
                            value: null,
                            minValue: -90,
                            maxValue: 90,
                            readOnly: true,
                            cls: 'pt-readonly-field'
                        },
                        {
                            xtype: 'numberfield',
                            name: 'lon',
                            itemId: 'stopLon',
                            fieldLabel: l('Дол'),
                            value: null,
                            margin: '0 0 0 6',
                            minValue: -180,
                            maxValue: 180,
                            readOnly: true,
                            cls: 'pt-readonly-field'
                        }
                    ]
                },
                {
                    xtype: 'container',
                    cls: 'pt-coords-hint',
                    html: '<i class="fa fa-info-circle"></i> ' +
                          l('Кликните по карте для указания координат')
                },
                {
                    xtype: 'numberfield',
                    name: 'radius',
                    itemId: 'stopRadius',
                    fieldLabel: l('Радиус (м)') + ':',
                    value: 30,
                    minValue: 5,
                    maxValue: 5000,
                    step: 5,
                    listeners: {
                        change: function(field, newValue) {
                            if (me.module && me.module.state.mapLayers.editingStopZone) {
                                me.module.state.mapLayers.editingStopZone.circle.setRadius(newValue);
                                me.module._updateEditingZoneMarkers();
                            }
                        }
                    }
                },
                // ========================================================================
                // НОВОЕ: ПОЛЕ ВЫБОРА RFID МЕТКИ
                // ========================================================================
                {
                    xtype: 'container',
                    cls: 'pt-rfid-selector',
                    itemId: 'rfidSelector',
                    layout: 'hbox',
                    fieldLabel: l('RFID метка') + ':',
                    labelWidth: 95,
                    items: [
                        {
                            xtype: 'displayfield',
                            itemId: 'rfidDisplay',
                            flex: 1,
                            cls: 'pt-rfid-display',
                            value: '<span class="pt-rfid-empty">' + l('Не выбрана') + '</span>'
                        },
                        {
                            xtype: 'button',
                            itemId: 'rfidSelectBtn',
                            iconCls: 'fa fa-microchip',
                            cls: 'pt-btn-rfid-select',
                            tooltip: l('Выбрать RFID метку'),
                            handler: function() {
                                me.onSelectRfidClick();
                            }
                        },
                        {
                            xtype: 'button',
                            itemId: 'rfidClearBtn',
                            iconCls: 'fa fa-times',
                            cls: 'pt-btn-rfid-clear',
                            tooltip: l('Очистить выбор'),
                            hidden: true,
                            handler: function() {
                                me.clearRfidSelection();
                            }
                        }
                    ]
                },
                // Кнопки действий
                {
                    xtype: 'container',
                    cls: 'pt-stop-edit-actions',
                    layout: 'hbox',
                    margin: '12 0 0 0',
                    defaults: {
                        flex: 1,
                        margin: '0 4 0 0'
                    },
                    items: [
                        {
                            xtype: 'button',
                            text: l('Сохранить'),
                            iconCls: 'fa fa-check',
                            cls: 'pt-btn-primary pt-btn-save',
                            handler: function() {
                                me.onSaveClick();
                            }
                        },
                        {
                            xtype: 'button',
                            text: l('Отмена'),
                            iconCls: 'fa fa-times',
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

        // Устанавливаем RFID метку
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

    // ========================================================================
    // RFID СЕКЦИЯ
    // ========================================================================

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

    // ========================================================================
    // ДЕЙСТВИЯ
    // ========================================================================

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
            Ext.Msg.alert(l('Ошибка'), l('Укажите координаты, кликнув по карте'));
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
// НОВОЕ: VIEW: RfidSelectWindow — МОДАЛЬНОЕ ОКНО ВЫБОРА RFID МЕТКИ
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
            // Список RFID меток
            {
                region: 'center',
                xtype: 'grid',
                itemId: 'tagsGrid',
                store: me.tagStore,
                selModel: { selType: 'rowmodel', mode: 'SINGLE' },
                columns: [
                    {
                        text: l('Код метки'),
                        dataIndex: 'code',
                        flex: 1.2,
                        renderer: function(v) {
                            return '<span style="font-weight:700;color:#7c3aed;font-family:monospace">' +
                                   '<i class="fa fa-microchip" style="margin-right:4px"></i>' +
                                   Ext.String.htmlEncode(v) + '</span>';
                        }
                    },
                    {
                        text: l('Название'),
                        dataIndex: 'name',
                        flex: 1
                    },
                    {
                        text: l('Описание'),
                        dataIndex: 'description',
                        flex: 1.2,
                        renderer: function(v) {
                            return '<span style="color:#64748b;font-size:12px">' +
                                   Ext.String.htmlEncode(v || '') + '</span>';
                        }
                    }
                ],
                emptyText: '<div style="text-align:center;padding:30px;color:#94a3b8">' +
                           '<i class="fa fa-microchip" style="font-size:32px"></i>' +
                           '<div style="margin-top:8px">' + l('Справочник RFID меток пуст') + '</div>' +
                           '</div>',
                tbar: [
                    {
                        xtype: 'textfield',
                        itemId: 'searchField',
                        emptyText: l('Поиск по коду, названию...'),
                        width: 220,
                        enableKeyEvents: true,
                        listeners: {
                            keyup: function(f) {
                                me.filterTags(f.getValue());
                            }
                        }
                    },
                    '->',
                    {
                        text: l('Обновить'),
                        iconCls: 'fa fa-refresh',
                        handler: function() {
                            me.refreshTags();
                        }
                    }
                ],
                listeners: {
                    select: function(grid, record) {
                        me.selectedTag = record.data;
                    }
                }
            },
            // Панель создания новой метки
            {
                region: 'south',
                height: 140,
                split: true,
                collapsible: true,
                title: l('Создать новую метку'),
                titleCollapse: true,
                bodyPadding: 10,
                defaults: {
                    anchor: '100%',
                    labelWidth: 90
                },
                items: [
                    {
                        xtype: 'textfield',
                        itemId: 'newCode',
                        fieldLabel: l('Код') + ':',
                        emptyText: l('Уникальный код метки'),
                        allowBlank: false
                    },
                    {
                        xtype: 'textfield',
                        itemId: 'newName',
                        fieldLabel: l('Название') + ':',
                        emptyText: l('Например: Метка автобуса №1')
                    },
                    {
                        xtype: 'button',
                        text: l('Создать метку'),
                        iconCls: 'fa fa-plus',
                        cls: 'pt-btn-primary',
                        handler: function() {
                            me.onCreateTagClick();
                        }
                    }
                ]
            }
        ];

        me.buttons = [
            {
                text: l('Выбрать'),
                iconCls: 'fa fa-check',
                cls: 'pt-btn-primary',
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
                text: l('Без метки'),
                iconCls: 'fa fa-ban',
                handler: function() {
                    me.fireEvent('clear', me);
                    me.close();
                }
            },
            {
                text: l('Отмена'),
                iconCls: 'fa fa-times',
                handler: function() {
                    me.close();
                }
            }
        ];

        // Если есть текущая метка — выделяем её
        if (me.currentTagId) {
            me.on('afterrender', function() {
                var grid = me.down('#tagsGrid');
                var idx = me.tagStore.find('id', me.currentTagId);
                if (idx !== -1) {
                    grid.getSelectionModel().select(idx);
                }
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

        // Очищаем форму
        me.down('#newCode').setValue('');
        me.down('#newName').setValue('');
    }
});


// ============================================================================
// VIEW: RouteTree (осталось без изменений)
// ============================================================================
