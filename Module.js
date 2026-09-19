// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки (исправленная версия)
// Strict compliance with AI_SPECS.md

// ==================== MAIN MODULE ====================
Ext.define('Store.passenger_transit.Module', {
    extend: 'Ext.Component',
    extensionName: 'passenger_transit',

    state: {
        routes: [],
        selectedRoute: null,
        selectedVehicle: null,
        stops: {},
        vehicles: {},
        mapLayers: {
            routes: {},
            stops: {},
            vehicles: {},
            tracks: {},
            editingPolyline: null,
            editingPoints: []
        },
        editMode: false,
        editType: null,
        editingRoutePoints: {
            forward: [],
            backward: []
        },
        pilotVehicles: [],
        routeEditMode: false,
        editDirection: 'forward'
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

        // Load CSS from proxied path
        var cssHref = me.getModuleBaseUrl() + 'style.css';
        if (!document.querySelector('link[href="' + cssHref + '"]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssHref;
            document.head.appendChild(link);
        }

        // Создаем левую панель через Ext.create (избегаем xtype)
        var navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 350,
            items: [
                Ext.create('Store.passenger_transit.view.RouteTree', {
                    module: me
                })
            ]
        });

        // Создаем основную панель через Ext.create
        var mainPanel = Ext.create('Store.passenger_transit.view.MainPanel', {
            module: me
        });

        // Связываем вкладку и панель
        navTab.map_frame = mainPanel;

        // Интеграция с PILOT skeleton
        if (window.skeleton && skeleton.navigation && skeleton.mapframe) {
            skeleton.navigation.add(navTab);
            skeleton.mapframe.add(mainPanel);

            // Кнопка в хедер
            if (skeleton.header && skeleton.header.insert) {
                skeleton.header.insert(6, {
                    xtype: 'button',
                    cls: 'header_tool passenger_transit-header-btn',
                    iconCls: 'fa fa-route',
                    tooltip: l('Пассажирские перевозки'),
                    handler: function () {
                        skeleton.navigation.setActiveTab(navTab);
                    },
                    scope: me
                });
            }

            me.loadRoutes();
            me.loadVehiclesFromPilot();
        } else {
            Ext.log('passenger_transit: skeleton not found');
        }
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
            failure: function () { Ext.log('passenger_transit: failed to load vehicles'); }
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
                        id: item.id, name: item.name, number: item.number || item.name,
                        group: parentGroup || '', lat: item.lat || 0, lon: item.lon || item.lng || 0,
                        dir: item.dir || 0, speed: item.speed || 0, online: item.state === 1
                    });
                }
            });
        }
        walk(groups);
        return vehicles;
    },

    getVehicleTrackFromPilot: function (vehicleId, fromDate, toDate, callback) {
        Ext.Ajax.request({
            url: '/ax/rep.php',
            params: { cmd: 'get_trips', object_id: vehicleId, from: fromDate, to: toDate, track_interval: 60, ignore_idle: 1 },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data && data.trips) callback(null, data.trips);
                else callback(new Error('No trips data'), null);
            },
            failure: function () { callback(new Error('API request failed'), null); }
        });
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
            if (direction === 'forward' && route.forward_points) me.state.editingRoutePoints.forward = Ext.Array.clone(route.forward_points);
            else if (direction === 'backward' && route.backward_points) me.state.editingRoutePoints.backward = Ext.Array.clone(route.backward_points);
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
            Ext.toast({ html: l('Добавлена точка') + ' #' + point.order_index, align: 'br', timeout: 2000 });
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

        Ext.toast({ html: l('Режим рисования: кликайте для добавления точек. Правый клик - завершить.'), align: 't', timeout: 8000 });
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

        var polyline = L.polyline(latlngs, { color: color, weight: 5, opacity: 0.9, dashArray: dashArray }).addTo(map.map);
        me.state.mapLayers.editingPolyline = polyline;

        points.forEach(function (p, index) {
            var marker = L.circleMarker([p.lat, p.lon], { radius: 6, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9 }).addTo(map.map);
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

        Ext.Msg.confirm(l('Сохранение маршрута'), l('Добавлено точек: ') + points.length + '. ' + l('Сохранить?'), function (btn) {
            if (btn === 'yes') me.saveRoutePoints(routeId, points, me.state.editDirection || 'forward');
            me.disableRouteEditMode();
        });
    },

    saveRoutePoints: function (routeId, points, direction) {
        var me = this;
        Ext.Ajax.request({
            url: '/store/passenger_transit/backend/api.php?action=save_route_points',
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
            failure: function () { Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения')); }
        });
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
        var mainPanel = me.getMainPanel();
        if (!mainPanel) return;

        if (!me.editToolbar) {
            me.editToolbar = Ext.create('Ext.toolbar.Toolbar', {
                dock: 'top',
                cls: 'pt-edit-toolbar',
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
                        }, scope: me
                    },
                    { xtype: 'tbtext', text: l('Точек: ') + '0' }
                ]
            });
            mainPanel.insert(0, me.editToolbar);
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

    // ==================== VEHICLE BINDING UI ====================
    showVehicleBindingDialog: function (routeId) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route) return;

        Ext.Ajax.request({
            url: '/store/passenger_transit/backend/api.php?action=get_route_vehicles',
            params: { route_id: routeId },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                me.createVehicleBindingWindow(route, data.vehicles || []);
            }
        });
    },

    createVehicleBindingWindow: function (route, boundVehicles) {
        var me = this;
        var pilotStore = Ext.create('Ext.data.Store', {
            fields: ['id', 'name', 'number', 'group', 'online'],
            data: me.state.pilotVehicles,
            filters: [function (item) { return !boundVehicles.some(function (bv) { return bv.vehicle_id === item.data.id; }); }]
        });

        var boundStore = Ext.create('Ext.data.Store', {
            fields: ['id', 'vehicle_id', 'vehicle_number'],
            data: boundVehicles.map(function (v) { return { id: v.id, vehicle_id: v.vehicle_id, vehicle_number: v.vehicle_number }; })
        });

        var win = Ext.create('Ext.window.Window', {
            title: l('Привязка ТС к маршруту') + ' - ' + route.name,
            width: 800, height: 500, layout: 'border', modal: true, cls: 'pt-vehicle-dialog',
            items: [
                {
                    region: 'west', title: l('Доступные ТС (из PILOT)'), width: 380, split: true, layout: 'fit',
                    items: [{
                        xtype: 'grid', store: pilotStore,
                        columns: [
                            { text: l('ТС'), dataIndex: 'number', flex: 1, renderer: function (v, m, r) {
                                var online = r.get('online');
                                m.tdAttr = 'style="background-color:' + (online ? '#dcfce7' : '#fee2e2') + '"';
                                return v + (online ? ' <span style="color:green">●</span>' : ' <span style="color:red">●</span>');
                            }},
                            { text: l('Группа'), dataIndex: 'group', width: 150 }
                        ],
                        selModel: { selType: 'checkboxmodel' },
                        tbar: [{ xtype: 'textfield', emptyText: l('Поиск...'), enableKeyEvents: true, listeners: {
                            keyup: function (f) {
                                pilotStore.clearFilter();
                                pilotStore.filterBy(function (r) { return r.get('number').toLowerCase().indexOf(f.getValue().toLowerCase()) !== -1; });
                            }
                        }}]
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
                        tbar: [{ text: l('Удалить'), iconCls: 'fa fa-trash', handler: function () {
                            var grid = this.up('grid');
                            var sel = grid.getSelectionModel().getSelection();
                            if (sel.length > 0) {
                                Ext.each(sel, function (r) { me.unbindVehicleFromRoute(route.id, r.get('vehicle_id')); });
                                boundStore.remove(sel);
                                pilotStore.reload();
                            }
                        }}]
                    }]
                }
            ],
            buttons: [
                {
                    text: l('Привязать выбранные'), iconCls: 'fa fa-link',
                    handler: function () {
                        var leftGrid = win.down('region[region=west] grid');
                        var sel = leftGrid.getSelectionModel().getSelection();
                        if (sel.length === 0) { Ext.Msg.alert(l('Внимание'), l('Выберите хотя бы одно ТС')); return; }
                        Ext.each(sel, function (r) { me.bindVehicleToRoute(route.id, r.get('id'), r.get('number')); });
                        setTimeout(function() { boundStore.reload(); pilotStore.reload(); leftGrid.getSelectionModel().deselectAll(); }, 500);
                    }
                },
                { text: l('Закрыть'), handler: function () { win.close(); } }
            ]
        });
        win.show();
    },

    bindVehicleToRoute: function (routeId, vehicleId, vehicleNumber) {
        Ext.Ajax.request({
            url: '/store/passenger_transit/backend/api.php?action=bind_vehicle',
            method: 'POST',
            jsonData: { route_id: routeId, vehicle_id: vehicleId, vehicle_number: vehicleNumber },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) Ext.toast({ html: l('ТС привязано'), align: 'br', timeout: 2000 });
            }
        });
    },

    unbindVehicleFromRoute: function (routeId, vehicleId) {
        Ext.Ajax.request({
            url: '/store/passenger_transit/backend/api.php?action=unbind_vehicle',
            method: 'POST',
            jsonData: { route_id: routeId, vehicle_id: vehicleId }
        });
    },

    // ==================== MAP FUNCTIONS ====================
    getPilotMap: function () {
        if (window.getActiveTabMapContainer) return getActiveTabMapContainer();
        return window.mapContainer || null;
    },

    drawRoute: function (routeId, forwardPoints, backwardPoints) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        this.clearRoute(routeId);

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

    drawStops: function (routeId, stops) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        this.clearStops(routeId);
        this.state.stops[routeId] = stops;
        var me = this;
        stops.forEach(function (stop, index) {
            var icon = L.divIcon({ className: 'pt-stop-marker', html: '<div class="pt-stop-number">' + (index + 1) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
            var marker = L.marker([stop.lat, stop.lon], { icon: icon, title: stop.name }).addTo(map.map);
            marker.bindPopup('<b>' + Ext.String.htmlEncode(stop.name) + '</b><br/>' + l('Остановка') + ' #' + (index + 1));
            marker.on('click', function () {
                if (me.state.selectedRoute) {
                    var mainPanel = me.getMainPanel();
                    if (mainPanel && mainPanel.memoPanel) mainPanel.memoPanel.highlightStop(index);
                }
            });
            if (!me.state.mapLayers.stops[routeId]) me.state.mapLayers.stops[routeId] = [];
            me.state.mapLayers.stops[routeId].push(marker);
        });
    },

    drawVehicles: function (routeId, vehicles) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        this.clearVehicles(routeId);
        var me = this;
        vehicles.forEach(function (veh) {
            var icon = L.divIcon({
                className: 'pt-vehicle-marker',
                html: '<div class="pt-vehicle-icon"><i class="fa fa-bus"></i></div><div class="pt-vehicle-number">' + Ext.String.htmlEncode(veh.number || '') + '</div>',
                iconSize: [40, 40], iconAnchor: [20, 20]
            });
            var marker = L.marker([veh.lat, veh.lon], { icon: icon, title: veh.number }).addTo(map.map);
            marker.on('click', function () { me.selectVehicle(veh.id, routeId); });
            if (!me.state.mapLayers.vehicles[routeId]) me.state.mapLayers.vehicles[routeId] = [];
            me.state.mapLayers.vehicles[routeId].push(marker);
        });
    },

    drawVehicleTrack: function (vehicleId, trackPoints, routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        this.clearTrack(vehicleId);
        var forwardPoints = [], backwardPoints = [];
        trackPoints.forEach(function (p) {
            if (p.direction === 'forward' || !p.direction) forwardPoints.push([p.lat, p.lon || p.lng]);
            else backwardPoints.push([p.lat, p.lon || p.lng]);
        });

        if (forwardPoints.length > 1) {
            var line = L.polyline(forwardPoints, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map.map);
            this.state.mapLayers.tracks[vehicleId + '_forward'] = line;
        }
        if (backwardPoints.length > 1) {
            var line = L.polyline(backwardPoints, { color: '#dc2626', weight: 5, opacity: 0.9, dashArray: '8, 6' }).addTo(map.map);
            this.state.mapLayers.tracks[vehicleId + '_backward'] = line;
        }
        if (trackPoints.length > 0) {
            var bounds = L.latLngBounds(trackPoints.map(function (p) { return [p.lat, p.lon || p.lng]; }));
            if (map.map.fitBounds) map.map.fitBounds(bounds, { padding: [50, 50] });
        }
    },

    clearRoute: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        ['forward', 'backward'].forEach(function (dir) {
            var key = routeId + '_' + dir;
            if (this.state.mapLayers.routes[key]) { map.map.removeLayer(this.state.mapLayers.routes[key]); delete this.state.mapLayers.routes[key]; }
        }.bind(this));
    },

    clearStops: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        if (this.state.mapLayers.stops[routeId]) {
            this.state.mapLayers.stops[routeId].forEach(function (m) { map.map.removeLayer(m); });
            delete this.state.mapLayers.stops[routeId];
        }
    },

    clearVehicles: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        if (this.state.mapLayers.vehicles[routeId]) {
            this.state.mapLayers.vehicles[routeId].forEach(function (m) { map.map.removeLayer(m); });
            delete this.state.mapLayers.vehicles[routeId];
        }
    },

    clearTrack: function (vehicleId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        ['forward', 'backward'].forEach(function (dir) {
            var key = vehicleId + '_' + dir;
            if (this.state.mapLayers.tracks[key]) { map.map.removeLayer(this.state.mapLayers.tracks[key]); delete this.state.mapLayers.tracks[key]; }
        }.bind(this));
    },

    // ==================== DATA LOADING & SELECTION ====================
    loadRoutes: function () {
        var me = this;
        Ext.Ajax.request({
            url: '/store/passenger_transit/backend/api.php?action=get_routes',
            method: 'GET',
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) { me.state.routes = data.routes || []; me.refreshRouteTree(); }
            },
            failure: function () { Ext.log('passenger_transit: failed to load routes'); }
        });
    },

    selectRoute: function (routeId) {
        var me = this;
        me.state.selectedRoute = routeId;
        var route = me.getRouteById(routeId);
        if (!route) return;

        me.drawRoute(routeId, route.forward_points, route.backward_points);
        if (route.stops && route.stops.length > 0) me.drawStops(routeId, route.stops);
        me.loadRouteVehicles(routeId);

        var mainPanel = me.getMainPanel();
        if (mainPanel && mainPanel.memoPanel) mainPanel.memoPanel.loadRoute(route);
        if (mainPanel && mainPanel.timelinePanel) mainPanel.timelinePanel.loadRoute(routeId);
    },

    selectVehicle: function (vehicleId, routeId) {
        var me = this;
        me.state.selectedVehicle = vehicleId;
        var fromDate = Ext.Date.format(new Date(), 'Y-m-d') + ' 00:00:00';
        var toDate = Ext.Date.format(new Date(), 'Y-m-d') + '23:59:59';

        me.getVehicleTrackFromPilot(vehicleId, fromDate, toDate, function (error, trips) {
            if (error) { Ext.Msg.alert(l('Ошибка'), l('Не удалось загрузить трек из PILOT API')); return; }
            var trackPoints = [];
            Ext.each(trips, function (trip) {
                if (trip.points) {
                    Ext.each(trip.points, function (p) { trackPoints.push({ lat: p.lat, lon: p.lon, time: p.time, direction: 'forward' }); });
                }
            });
            me.drawVehicleTrack(vehicleId, trackPoints, routeId);
            Ext.Msg.alert(l('ТС') + ' ' + vehicleId, l('Выполнено рейсов') + ': <b>' + trips.length + '</b>');
        });
    },

    loadRouteVehicles: function (routeId) {
        var me = this;
        Ext.Ajax.request({
            url: '/store/passenger_transit/backend/api.php?action=get_route_vehicles',
            params: { route_id: routeId },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success && data.vehicles) {
                    var enrichedVehicles = data.vehicles.map(function (v) {
                        var pilotVeh = me.state.pilotVehicles.find(function (pv) { return pv.id === v.vehicle_id; });
                        return Ext.apply({ lat: pilotVeh ? pilotVeh.lat : 0, lon: pilotVeh ? pilotVeh.lon : 0, number: v.vehicle_number || (pilotVeh ? pilotVeh.number : 'N/A') }, v);
                    });
                    me.drawVehicles(routeId, enrichedVehicles);
                }
            }
        });
    },

    enableEditMode: function () {
        var me = this;
        if (me.state.routeEditMode) { Ext.Msg.alert(l('Внимание'), l('Сначала завершите редактирование маршрута')); return; }
        me.state.editMode = true;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me._mapClickHandler = function (e) {
            if (!me.state.editMode || !me.state.selectedRoute) return;
            Ext.Msg.prompt(l('Новая остановка'), l('Название остановки') + ':', function (btn, text) {
                if (btn === 'ok' && text) me.addStop(me.state.selectedRoute, { name: text, lat: e.latlng.lat, lon: e.latlng.lng });
            }, this, false, '');
        };
        map.map.on('click', me._mapClickHandler);
        Ext.toast({ html: l('Кликните по карте для добавления остановки'), align: 't', timeout: 5000 });
    },

    disableEditMode: function () {
        var me = this;
        me.state.editMode = false;
        var map = me.getPilotMap();
        if (map && map.map && me._mapClickHandler) map.map.off('click', me._mapClickHandler);
    },

    addStop: function (routeId, stop) {
        var me = this;
        Ext.Ajax.request({
            url: '/store/passenger_transit/backend/api.php?action=add_stop',
            method: 'POST',
            jsonData: { route_id: routeId, stop: stop },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) me.selectRoute(routeId);
            }
        });
    },

    getRouteById: function (routeId) {
        var found = null;
        Ext.each(this.state.routes, function (r) { if (r.id == routeId) { found = r; return false; } });
        return found;
    },

    getMainPanel: function () {
        if (skeleton.mapframe) return skeleton.mapframe.items && skeleton.mapframe.items.getAt ? skeleton.mapframe.items.getAt(0) : null;
        return null;
    },

    refreshRouteTree: function () {
        var mainPanel = this.getMainPanel();
        if (mainPanel && mainPanel.routeTree) mainPanel.routeTree.loadRoutes(this.state.routes);
    }
});


// ==================== VIEW: RouteTree ====================
Ext.define('Store.passenger_transit.view.RouteTree', {
    extend: 'Ext.tree.Panel',
    rootVisible: false,
    useArrows: true,
    cls: 'pt-route-tree',

    initComponent: function () {
        var me = this;
        me.store = Ext.create('Ext.data.TreeStore', { root: { expanded: true, children: [] } });

        me.tbar = [
            { text: l('Добавить маршрут'), iconCls: 'fa fa-plus', handler: me.onAddRoute, scope: me },
            { text: l('Редактировать'), iconCls: 'fa fa-edit', handler: me.onToggleEdit, scope: me, itemId: 'editBtn' },
            {
                text: l('Рисовать маршрут'), iconCls: 'fa fa-pencil',
                handler: function() {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) me.module.enableRouteEditMode(rec.data.route_id, 'forward');
                    else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
                }, scope: me
            },
            '-',
            {
                text: l('Привязать ТС'), iconCls: 'fa fa-link',
                handler: function() {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) me.module.showVehicleBindingDialog(rec.data.route_id);
                    else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
                }, scope: me
            }
        ];

        me.columns = [
            { xtype: 'treecolumn', text: l('Маршрут'), dataIndex: 'name', flex: 1 },
            { text: l('ТС'), dataIndex: 'vehicle_count', width: 50, align: 'center' }
        ];

        me.listeners = { itemclick: me.onRouteClick, scope: me };
        me.callParent(arguments);
    },

    loadRoutes: function (routes) {
        var me = this;
        var children = routes.map(function (r) {
            return { text: r.name, name: r.name, vehicle_count: r.vehicle_count || 0, route_id: r.id, leaf: true, iconCls: 'fa fa-route' };
        });
        me.getRootNode().removeAll();
        me.getRootNode().appendChild(children);
    },

    onRouteClick: function (view, record) {
        if (this.module && record.data.route_id) this.module.selectRoute(record.data.route_id);
    },

    onAddRoute: function () {
        var me = this;
        Ext.Msg.prompt(l('Новый маршрут'), l('Название маршрута') + ':', function (btn, text) {
            if (btn === 'ok' && text) {
                Ext.Ajax.request({
                    url: '/store/passenger_transit/backend/api.php?action=create_route',
                    method: 'POST',
                    jsonData: { name: text },
                    success: function (resp) {
                        var data = Ext.decode(resp.responseText);
                        if (data.success && me.module) me.module.loadRoutes();
                    }
                });
            }
        }, this, false, '');
    },

    onToggleEdit: function () {
        if (this.module) {
            if (this.module.state.editMode) this.module.disableEditMode();
            else this.module.enableEditMode();
        }
    }
});


// ==================== VIEW: MainPanel ====================
Ext.define('Store.passenger_transit.view.MainPanel', {
    extend: 'Ext.panel.Panel',
    layout: 'border',
    cls: 'pt-main-panel',

    initComponent: function () {
        var me = this;

        // ИСПРАВЛЕНИЕ: используем Ext.create вместо xtype для предотвращения динамической загрузки файлов
        me.items = [
            {
                region: 'center',
                xtype: 'panel',
                cls: 'pt-map-placeholder',
                html: '<div class="pt-map-hint">' + l('Используйте карту PILOT для отображения маршрутов. Выберите маршрут слева.') + '</div>'
            },
            Ext.create('Store.passenger_transit.view.RouteMemoPanel', {
                region: 'east',
                module: me.module,
                width: 320,
                split: true,
                collapsible: true,
                title: l('Мнемосхема')
            }),
            Ext.create('Store.passenger_transit.view.TimelinePanel', {
                region: 'south',
                module: me.module,
                height: 180,
                split: true,
                title: l('График рейсов')
            })
        ];

        me.callParent(arguments);
    }
});


// ==================== VIEW: RouteMemoPanel ====================
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
        me.items = [{ xtype: 'panel', itemId: 'memoContent', autoScroll: true, html: '<div class="pt-memo-empty">' + l('Выберите маршрут') + '</div>' }];
        me.callParent(arguments);
    },

    loadRoute: function (route) {
        var me = this;
        me.currentRoute = route;
        me.currentDirection = 'forward';
        me.down('#memoContent').update(me.renderMemo(route, 'forward'));
    },

    renderMemo: function (route, direction) {
        if (!route || !route.stops || route.stops.length === 0) return '<div class="pt-memo-empty">' + l('Нет остановок') + '</div>';
        var stops = route.stops;
        var html = '<div class="pt-memo-route"><div class="pt-memo-header">' + Ext.String.htmlEncode(route.name) + '</div><div class="pt-memo-stops">';
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
            el.query('.pt-memo-stop').forEach(function (node) { Ext.fly(node).removeCls('pt-memo-stop-highlight'); });
            var target = el.query('.pt-memo-stop[data-index="' + index + '"]')[0];
            if (target) { Ext.fly(target).addCls('pt-memo-stop-highlight'); target.scrollIntoView(); }
        }
    },

    showDirection: function (direction) {
        if (this.currentRoute) {
            this.down('#memoContent').update(this.renderMemo(this.currentRoute, direction));
            this.currentDirection = direction;
        }
    }
});


// ==================== VIEW: TimelinePanel ====================
Ext.define('Store.passenger_transit.view.TimelinePanel', {
    extend: 'Ext.panel.Panel',
    layout: 'fit',
    cls: 'pt-timeline-panel',

    initComponent: function () {
        var me = this;
        me.items = [{ xtype: 'panel', itemId: 'chartContainer', html: '<div id="pt-timeline-chart" style="width:100%;height:100%;"></div>' }];
        me.callParent(arguments);
    },

    loadRoute: function (routeId) {
        var me = this;
        Ext.Ajax.request({
            url: '/store/passenger_transit/backend/api.php?action=get_timeline',
            params: { route_id: routeId, date: Ext.Date.format(new Date(), 'Y-m-d') },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success && data.timeline) me.renderChart(data.timeline);
            }
        });
    },

    renderChart: function (timelineData) {
        if (!window.Highcharts) { Ext.log('passenger_transit: Highcharts not available'); return; }
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
