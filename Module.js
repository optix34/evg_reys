// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки (ИСПРАВЛЕННАЯ ДЕМО-ВЕРСИЯ)
// Работает на GitHub Pages без PHP. Использует собственный MapContainer.

// ==================== VIEW: MapPanel (Собственная карта) ====================
Ext.define('Store.passenger_transit.view.MapPanel', {
    extend: 'Ext.panel.Panel',
    layout: 'fit',
    cls: 'map_canvas',
    bodyCls: 'map_canvas',
    
    initComponent: function () {
        var me = this;
        me.listeners = {
            render: me.initMap,
            resize: me.resizeMap,
            scope: me
        };
        me.callParent(arguments);
    },

    initMap: function () {
        var me = this;
        // Инициализация PILOT MapContainer (обертка над Leaflet)
        me.map = new MapContainer(me.id + '-map');
        // Координаты центра (Москва), зум 11
        me.map.init(55.75, 37.65, 11, me.id + '-body', false);
    },

    resizeMap: function () {
        var me = this;
        if (me.map && me.map.checkResize) {
            me.map.checkResize();
        }
    },

    getLeafletMap: function () {
        return this.map ? this.map.map : null;
    },

    getMapContainer: function () {
        return this.map;
    }
});

// ==================== MAIN MODULE ====================
Ext.define('Store.passenger_transit.Module', {
    extend: 'Ext.Component',
    extensionName: 'passenger_transit',

    state: {
        // Встроенные демо-данные для немедленного отображения
        routes: [
            {
                id: 1,
                name: 'Маршрут №1 (Демо: Центр - Вокзал)',
                vehicle_count: 2,
                stops: [
                    { id: 1, name: 'Центральная площадь', lat: 55.751244, lon: 37.618423, order_index: 0 },
                    { id: 2, name: 'Парк Культуры', lat: 55.733000, lon: 37.580000, order_index: 1 },
                    { id: 3, name: 'Киевский вокзал', lat: 55.744000, lon: 37.566000, order_index: 2 }
                ],
                forward_points: [
                    { lat: 55.751244, lon: 37.618423, order_index: 0 },
                    { lat: 55.733000, lon: 37.580000, order_index: 1 },
                    { lat: 55.744000, lon: 37.566000, order_index: 2 }
                ],
                backward_points: [
                    { lat: 55.744000, lon: 37.566000, order_index: 0 },
                    { lat: 55.733000, lon: 37.580000, order_index: 1 },
                    { lat: 55.751244, lon: 37.618423, order_index: 2 }
                ]
            }
        ],
        selectedRoute: null,
        mapLayers: {
            routes: {}, stops: {}, vehicles: {}, tracks: {},
            editingPolyline: null, editingPoints: []
        },
        editMode: false,
        routeEditMode: false,
        editDirection: 'forward',
        editingRoutePoints: { forward: [], backward: [] },
        pilotVehicles: [
            { id: '101', name: 'Автобус 1', number: 'А123АА 77', group: 'Пассажирские', lat: 55.751244, lon: 37.618423, online: true },
            { id: '102', name: 'Автобус 2', number: 'В456ВВ 77', group: 'Пассажирские', lat: 55.733000, lon: 37.580000, online: true }
        ]
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
        var cssHref = me.getModuleBaseUrl() + 'style.css';
        if (!document.querySelector('link[href="' + cssHref + '"]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssHref;
            document.head.appendChild(link);
        }

        var navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 350,
            items: [Ext.create('Store.passenger_transit.view.RouteTree', { module: me })]
        });

        var mainPanel = Ext.create('Store.passenger_transit.view.MainPanel', { module: me });
        
        // Критически важная связь для PILOT
        navTab.map_frame = mainPanel;

        if (window.skeleton && skeleton.navigation && skeleton.mapframe) {
            skeleton.navigation.add(navTab);
            skeleton.mapframe.add(mainPanel);

            if (skeleton.header && skeleton.header.insert) {
                skeleton.header.insert(6, {
                    xtype: 'button',
                    cls: 'header_tool passenger_transit-header-btn',
                    iconCls: 'fa fa-route',
                    tooltip: l('Пассажирские перевозки'),
                    handler: function () { skeleton.navigation.setActiveTab(navTab); },
                    scope: me
                });
            }
            
            // Загружаем данные и сразу выбираем первый маршрут для демонстрации
            me.loadRoutes();
            if (me.state.routes.length > 0) {
                setTimeout(function() { me.selectRoute(me.state.routes[0].id); }, 500);
            }
        } else {
            Ext.log('passenger_transit: skeleton not found');
        }
    },

    // ==================== HELPERS ====================
    getMainPanel: function () {
        if (skeleton.mapframe) return skeleton.mapframe.items && skeleton.mapframe.items.getAt ? skeleton.mapframe.items.getAt(0) : null;
        return null;
    },

    getMapPanel: function () {
        var mainPanel = this.getMainPanel();
        return mainPanel ? mainPanel.down('#mapPanel') : null;
    },

    getRouteById: function (routeId) {
        var found = null;
        Ext.each(this.state.routes, function (r) { if (r.id == routeId) { found = r; return false; } });
        return found;
    },

    // ==================== ДЕМО-МЕТОДЫ (Вместо PHP Backend) ====================
    loadRoutes: function () {
        this.refreshRouteTree();
    },

    createRoute: function (name) {
        var me = this;
        var newId = me.state.routes.length > 0 ? Math.max.apply(null, me.state.routes.map(function(r){return r.id;})) + 1 : 1;
        me.state.routes.push({
            id: newId, name: name, vehicle_count: 0,
            stops: [], forward_points: [], backward_points: []
        });
        me.refreshRouteTree();
        me.selectRoute(newId);
        Ext.toast({ html: l('Маршрут создан (Демо)'), align: 't', timeout: 2000 });
    },

    addStop: function (routeId, stop) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (route) {
            var newIndex = route.stops.length;
            route.stops.push({
                id: Date.now(), name: stop.name, lat: stop.lat, lon: stop.lon, order_index: newIndex
            });
            me.selectRoute(routeId); // Перерисовать
            Ext.toast({ html: l('Остановка добавлена (Демо)'), align: 't', timeout: 2000 });
        }
    },

    saveRoutePoints: function (routeId, points, direction) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (route) {
            route[direction + '_points'] = points.map(function(p, i) {
                return { lat: p.lat, lon: p.lon, order_index: i };
            });
            me.selectRoute(routeId); // Перерисовать
            Ext.toast({ html: l('Маршрут сохранен (Демо)'), align: 't', timeout: 2000 });
        }
    },

    getRouteVehicles: function (routeId) {
        return this.state.pilotVehicles.filter(function(v) { return v.group === 'Пассажирские'; });
    },

    getVehicleTrack: function (vehicleId, routeId) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route || !route.forward_points) return [];
        return route.forward_points.map(function(p, i) {
            return {
                lat: p.lat + (Math.random() - 0.5) * 0.001,
                lon: p.lon + (Math.random() - 0.5) * 0.001,
                direction: 'forward', time: '10:' + (10 + i * 5) + ':00', speed: 40
            };
        });
    },

    getTimeline: function (routeId) {
        var hours = [], trips = [];
        for (var h = 6; h <= 22; h++) {
            hours.push(h + ':00');
            trips.push(h >= 7 && h <= 9 || h >= 17 && h <= 19 ? Math.floor(Math.random() * 5) + 3 : Math.floor(Math.random() * 2));
        }
        return { hours: hours, trips: trips };
    },

    // ==================== MAP DRAWING LOGIC ====================
    drawRoute: function (routeId, forwardPoints, backwardPoints) {
        var mapPanel = this.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        
        this.clearRoute(routeId);

        if (forwardPoints && forwardPoints.length > 1) {
            var line = L.polyline(forwardPoints.map(function (p) { return [p.lat, p.lon]; }), { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(leafletMap);
            this.state.mapLayers.routes[routeId + '_forward'] = line;
        }
        if (backwardPoints && backwardPoints.length > 1) {
            var line = L.polyline(backwardPoints.map(function (p) { return [p.lat, p.lon]; }), { color: '#dc2626', weight: 4, opacity: 0.85, dashArray: '8, 6' }).addTo(leafletMap);
            this.state.mapLayers.routes[routeId + '_backward'] = line;
        }
    },

    drawStops: function (routeId, stops) {
        var mapPanel = this.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        
        this.clearStops(routeId);
        var me = this;
        stops.forEach(function (stop, index) {
            var icon = L.divIcon({ className: 'pt-stop-marker', html: '<div class="pt-stop-number">' + (index + 1) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
            var marker = L.marker([stop.lat, stop.lon], { icon: icon, title: stop.name }).addTo(leafletMap);
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
        var mapPanel = this.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        
        this.clearVehicles(routeId);
        var me = this;
        vehicles.forEach(function (veh) {
            var icon = L.divIcon({
                className: 'pt-vehicle-marker',
                html: '<div class="pt-vehicle-icon"><i class="fa fa-bus"></i></div><div class="pt-vehicle-number">' + Ext.String.htmlEncode(veh.number || '') + '</div>',
                iconSize: [40, 40], iconAnchor: [20, 20]
            });
            var marker = L.marker([veh.lat, veh.lon], { icon: icon, title: veh.number }).addTo(leafletMap);
            marker.on('click', function () { me.selectVehicle(veh.id, routeId); });
            if (!me.state.mapLayers.vehicles[routeId]) me.state.mapLayers.vehicles[routeId] = [];
            me.state.mapLayers.vehicles[routeId].push(marker);
        });
    },

    drawVehicleTrack: function (vehicleId, trackPoints, routeId) {
        var mapPanel = this.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        
        this.clearTrack(vehicleId);
        var forwardPoints = trackPoints.map(function (p) { return [p.lat, p.lon]; });
        if (forwardPoints.length > 1) {
            var line = L.polyline(forwardPoints, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(leafletMap);
            this.state.mapLayers.tracks[vehicleId + '_forward'] = line;
            leafletMap.fitBounds(line.getBounds(), { padding: [50, 50] });
        }
    },

    clearRoute: function (routeId) {
        var mapPanel = this.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        ['forward', 'backward'].forEach(function (dir) {
            var key = routeId + '_' + dir;
            if (this.state.mapLayers.routes[key]) { leafletMap.removeLayer(this.state.mapLayers.routes[key]); delete this.state.mapLayers.routes[key]; }
        }.bind(this));
    },

    clearStops: function (routeId) {
        var mapPanel = this.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        if (this.state.mapLayers.stops[routeId]) {
            this.state.mapLayers.stops[routeId].forEach(function (m) { leafletMap.removeLayer(m); });
            delete this.state.mapLayers.stops[routeId];
        }
    },

    clearVehicles: function (routeId) {
        var mapPanel = this.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        if (this.state.mapLayers.vehicles[routeId]) {
            this.state.mapLayers.vehicles[routeId].forEach(function (m) { leafletMap.removeLayer(m); });
            delete this.state.mapLayers.vehicles[routeId];
        }
    },

    clearTrack: function (vehicleId) {
        var mapPanel = this.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        var key = vehicleId + '_forward';
        if (this.state.mapLayers.tracks[key]) { leafletMap.removeLayer(this.state.mapLayers.tracks[key]); delete this.state.mapLayers.tracks[key]; }
    },

    // ==================== UI ACTIONS ====================
    selectRoute: function (routeId) {
        var me = this;
        me.state.selectedRoute = routeId;
        var route = me.getRouteById(routeId);
        if (!route) return;

        me.drawRoute(routeId, route.forward_points, route.backward_points);
        if (route.stops && route.stops.length > 0) me.drawStops(routeId, route.stops);
        
        var demoVehicles = me.getRouteVehicles(routeId).map(function(v) {
            return Ext.apply({ vehicle_number: v.number }, v);
        });
        me.drawVehicles(routeId, demoVehicles);

        var mainPanel = me.getMainPanel();
        if (mainPanel && mainPanel.memoPanel) mainPanel.memoPanel.loadRoute(route);
        if (mainPanel && mainPanel.timelinePanel) mainPanel.timelinePanel.renderChart(me.getTimeline(routeId));
    },

    selectVehicle: function (vehicleId, routeId) {
        var me = this;
        var trackPoints = me.getVehicleTrack(vehicleId, routeId);
        me.drawVehicleTrack(vehicleId, trackPoints, routeId);
        Ext.Msg.alert(l('ТС'), l('Выполнено рейсов') + ': <b>' + Math.floor(Math.random() * 5 + 3) + '</b><br/>(Демо-данные)');
    },

    enableRouteEditMode: function (routeId, direction) {
        var me = this;
        me.state.routeEditMode = true;
        me.state.selectedRoute = routeId;
        me.state.editDirection = direction || 'forward';
        me.state.editingRoutePoints = { forward: [], backward: [] };
        
        var route = me.getRouteById(routeId);
        if (route && route[direction + '_points']) {
            me.state.editingRoutePoints[direction] = Ext.Array.clone(route[direction + '_points']);
        }

        var mapPanel = me.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();

        me._routeEditClickHandler = function (e) {
            if (!me.state.routeEditMode) return;
            var point = { lat: e.latlng.lat, lon: e.latlng.lng, order_index: me.state.editingRoutePoints[me.state.editDirection].length };
            me.state.editingRoutePoints[me.state.editDirection].push(point);
            me.drawEditingPolyline();
            me.updateEditToolbarStats();
        };

        me._routeEditRightClickHandler = function (e) {
            if (!me.state.routeEditMode) return;
            if (e.originalEvent) e.originalEvent.preventDefault();
            me.finishRouteEditing();
        };

        leafletMap.on('click', me._routeEditClickHandler);
        leafletMap.on('contextmenu', me._routeEditRightClickHandler);
        me.showRouteEditToolbar();
        Ext.toast({ html: l('Кликайте по карте для добавления точек. Правый клик - завершить.'), align: 't', timeout: 5000 });
    },

    drawEditingPolyline: function () {
        var me = this;
        var mapPanel = me.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();

        if (me.state.mapLayers.editingPolyline) leafletMap.removeLayer(me.state.mapLayers.editingPolyline);
        if (me.state.mapLayers.editingPoints) {
            me.state.mapLayers.editingPoints.forEach(function (m) { leafletMap.removeLayer(m); });
            me.state.mapLayers.editingPoints = [];
        }

        var dir = me.state.editDirection;
        var points = me.state.editingRoutePoints[dir];
        if (points.length === 0) return;

        var latlngs = points.map(function (p) { return [p.lat, p.lon]; });
        var color = dir === 'forward' ? '#2563eb' : '#dc2626';
        var polyline = L.polyline(latlngs, { color: color, weight: 5, opacity: 0.9, dashArray: dir === 'backward' ? '8, 6' : null }).addTo(leafletMap);
        me.state.mapLayers.editingPolyline = polyline;

        points.forEach(function (p, index) {
            var marker = L.circleMarker([p.lat, p.lon], { radius: 6, fillColor: color, color: '#fff', weight: 2 }).addTo(leafletMap);
            marker.bindPopup(l('Точка') + ' #' + (index + 1));
            me.state.mapLayers.editingPoints.push(marker);
        });
    },

    finishRouteEditing: function () {
        var me = this;
        if (!me.state.routeEditMode) return;
        var points = me.state.editingRoutePoints[me.state.editDirection];
        if (points.length < 2) {
            Ext.Msg.alert(l('Ошибка'), l('Минимум 2 точки'));
            return;
        }
        Ext.Msg.confirm(l('Сохранение'), l('Точек: ') + points.length + '. ' + l('Сохранить?'), function (btn) {
            if (btn === 'yes') me.saveRoutePoints(me.state.selectedRoute, points, me.state.editDirection);
            me.disableRouteEditMode();
        });
    },

    disableRouteEditMode: function () {
        var me = this;
        me.state.routeEditMode = false;
        var mapPanel = me.getMapPanel();
        if (mapPanel && mapPanel.getLeafletMap()) {
            var leafletMap = mapPanel.getLeafletMap();
            if (me._routeEditClickHandler) leafletMap.off('click', me._routeEditClickHandler);
            if (me._routeEditRightClickHandler) leafletMap.off('contextmenu', me._routeEditRightClickHandler);
        }
        if (me.state.mapLayers.editingPolyline && mapPanel && mapPanel.getLeafletMap()) {
            mapPanel.getLeafletMap().removeLayer(me.state.mapLayers.editingPolyline);
            me.state.mapLayers.editingPolyline = null;
        }
        if (me.state.mapLayers.editingPoints && mapPanel && mapPanel.getLeafletMap()) {
            me.state.mapLayers.editingPoints.forEach(function (m) { mapPanel.getLeafletMap().removeLayer(m); });
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
                dock: 'top', cls: 'pt-edit-toolbar',
                items: [
                    { text: l('Завершить'), iconCls: 'fa fa-check', handler: me.finishRouteEditing, scope: me },
                    { text: l('Отмена'), iconCls: 'fa fa-times', handler: me.disableRouteEditMode, scope: me },
                    '-',
                    { text: l('Удалить последнюю'), iconCls: 'fa fa-undo', handler: function () { me.state.editingRoutePoints[me.state.editDirection].pop(); me.drawEditingPolyline(); me.updateEditToolbarStats(); }, scope: me },
                    { xtype: 'tbtext', text: l('Точек: 0') }
                ]
            });
            mainPanel.insert(0, me.editToolbar);
        }
        me.editToolbar.show();
        me.updateEditToolbarStats();
    },

    hideRouteEditToolbar: function () { if (this.editToolbar) this.editToolbar.hide(); },
    
    updateEditToolbarStats: function () {
        var me = this;
        if (!me.editToolbar) return;
        var textItem = me.editToolbar.down('tbtext');
        if (textItem) textItem.setText(l('Точек: ') + me.state.editingRoutePoints[me.state.editDirection].length);
    },

    enableEditMode: function () {
        var me = this;
        if (me.state.routeEditMode) { Ext.Msg.alert(l('Внимание'), l('Сначала завершите редактирование маршрута')); return; }
        me.state.editMode = true;
        var mapPanel = me.getMapPanel();
        if (!mapPanel || !mapPanel.getLeafletMap()) return;
        var leafletMap = mapPanel.getLeafletMap();
        
        me._mapClickHandler = function (e) {
            if (!me.state.editMode || !me.state.selectedRoute) return;
            Ext.Msg.prompt(l('Новая остановка'), l('Название') + ':', function (btn, text) {
                if (btn === 'ok' && text) me.addStop(me.state.selectedRoute, { name: text, lat: e.latlng.lat, lon: e.latlng.lng });
            }, this, false, '');
        };
        leafletMap.on('click', me._mapClickHandler);
        Ext.toast({ html: l('Кликните по карте для добавления остановки'), align: 't', timeout: 5000 });
    },

    disableEditMode: function () {
        var me = this;
        me.state.editMode = false;
        var mapPanel = me.getMapPanel();
        if (mapPanel && mapPanel.getLeafletMap() && me._mapClickHandler) {
            mapPanel.getLeafletMap().off('click', me._mapClickHandler);
        }
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
            { text: l('Добавить'), iconCls: 'fa fa-plus', handler: me.onAddRoute, scope: me },
            { text: l('Остановки'), iconCls: 'fa fa-edit', handler: me.onToggleEdit, scope: me },
            { text: l('Рисовать'), iconCls: 'fa fa-pencil', handler: function() {
                var rec = me.getSelectionModel().getSelection()[0];
                if (rec && me.module) me.module.enableRouteEditMode(rec.data.route_id, 'forward');
                else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
            }, scope: me }
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
        Ext.Msg.prompt(l('Новый маршрут'), l('Название') + ':', function (btn, text) {
            if (btn === 'ok' && text && me.module) me.module.createRoute(text);
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
        me.items = [
            { 
                region: 'center',
                xtype: 'Store.passenger_transit.view.MapPanel',
                itemId: 'mapPanel' 
            },
            Ext.create('Store.passenger_transit.view.RouteMemoPanel', { 
                region: 'east', module: me.module, width: 300, split: true, collapsible: true, title: l('Мнемосхема'),
                listeners: { afterrender: function() { me.memoPanel = this; } }
            }),
            Ext.create('Store.passenger_transit.view.TimelinePanel', { 
                region: 'south', module: me.module, height: 180, split: true, title: l('График рейсов'),
                listeners: { afterrender: function() { me.timelinePanel = this; } }
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
        this.currentRoute = route;
        this.down('#memoContent').update(this.renderMemo(route, 'forward'));
    },
    renderMemo: function (route, direction) {
        if (!route || !route.stops || route.stops.length === 0) return '<div class="pt-memo-empty">' + l('Нет остановок') + '</div>';
        var html = '<div class="pt-memo-route"><div class="pt-memo-header">' + Ext.String.htmlEncode(route.name) + '</div><div class="pt-memo-stops">';
        route.stops.forEach(function (stop, index) {
            var isFwd = direction === 'forward';
            var num = isFwd ? (index + 1) : (route.stops.length - index);
            html += '<div class="pt-memo-stop ' + (isFwd ? 'pt-stop-forward' : 'pt-stop-backward') + '" data-index="' + index + '">';
            html += '<div class="pt-memo-stop-number">' + num + '</div>';
            html += '<div class="pt-memo-stop-name">' + Ext.String.htmlEncode(stop.name) + '</div></div>';
        });
        return html + '</div></div>';
    },
    highlightStop: function (index) {
        var el = this.down('#memoContent').getEl();
        if (el) {
            el.query('.pt-memo-stop').forEach(function (node) { Ext.fly(node).removeCls('pt-memo-stop-highlight'); });
            var target = el.query('.pt-memo-stop[data-index="' + index + '"]')[0];
            if (target) { Ext.fly(target).addCls('pt-memo-stop-highlight'); target.scrollIntoView(); }
        }
    },
    showDirection: function (dir) { if (this.currentRoute) this.down('#memoContent').update(this.renderMemo(this.currentRoute, dir)); }
});

// ==================== VIEW: TimelinePanel ====================
Ext.define('Store.passenger_transit.view.TimelinePanel', {
    extend: 'Ext.panel.Panel',
    layout: 'fit',
    cls: 'pt-timeline-panel',
    initComponent: function () {
        this.items = [{ xtype: 'panel', itemId: 'chartContainer', html: '<div id="pt-timeline-chart" style="width:100%;height:100%;"></div>' }];
        this.callParent(arguments);
    },
    renderChart: function (timelineData) {
        if (!window.Highcharts) return;
        var container = document.getElementById('pt-timeline-chart');
        if (!container) return;
        if (this.chart) this.chart.destroy();
        this.chart = Highcharts.chart(container, {
            chart: { type: 'column', backgroundColor: 'transparent' },
            title: { text: l('Рейсы по времени') },
            xAxis: { categories: timelineData.hours, title: { text: l('Время') } },
            yAxis: { title: { text: l('Количество') }, min: 0 },
            series: [{ name: l('Рейсы'), data: timelineData.trips, color: '#2563eb' }],
            credits: { enabled: false }
        });
    }
});
