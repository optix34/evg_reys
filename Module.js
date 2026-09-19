// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки
// Использует существующую карту PILOT и реальные ТС из PILOT API

Ext.define('Store.passenger_transit.Module', {
    extend: 'Ext.Component',
    extensionName: 'passenger_transit',

    state: {
        routes: [],
        selectedRoute: null,
        pilotVehicles: [],
        mapLayers: {
            routes: {},
            stops: {},
            vehicles: {},
            tracks: {},
            editingPolyline: null,
            editingPoints: []
        },
        editMode: false,
        routeEditMode: false,
        editDirection: 'forward',
        editingRoutePoints: { forward: [], backward: [] }
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
        Ext.log('passenger_transit: Инициализация модуля');

        // Загрузка CSS
        var cssHref = me.getModuleBaseUrl() + 'style.css';
        if (!document.querySelector('link[href="' + cssHref + '"]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssHref;
            document.head.appendChild(link);
        }

        // Загрузка сохраненных маршрутов из localStorage
        me.loadRoutesFromStorage();

        // Создание левой панели с деревом маршрутов
        var navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 350,
            items: [Ext.create('Store.passenger_transit.view.RouteTree', { module: me })]
        });

        // ВАЖНО: НЕ добавляем mainPanel в skeleton.mapframe
        // Используем существующую карту PILOT

        if (window.skeleton && skeleton.navigation) {
            skeleton.navigation.add(navTab);

            // Кнопка в хедер
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

            // Загрузка реальных ТС из PILOT
            me.loadVehiclesFromPilot();

            // Если есть маршруты, выбираем первый
            if (me.state.routes.length > 0) {
                setTimeout(function () { me.selectRoute(me.state.routes[0].id); }, 500);
            }
        } else {
            Ext.log('passenger_transit: skeleton not found');
        }
    },

    // ==================== PILOT API: ЗАГРУЗКА ТС ====================
    loadVehiclesFromPilot: function () {
        var me = this;
        Ext.Ajax.request({
            url: '/ax/tree.php',
            params: { vehs: 1, state: 1, lat: 1, lon: 1 },
            success: function (resp) {
                try {
                    var groups = Ext.decode(resp.responseText);
                    me.state.pilotVehicles = me.parsePilotTree(groups);
                    Ext.log('passenger_transit: Загружено ТС: ' + me.state.pilotVehicles.length);
                    // Перерисовываем ТС для выбранного маршрута
                    if (me.state.selectedRoute) {
                        me.drawVehiclesForSelectedRoute();
                    }
                } catch (e) {
                    Ext.log('passenger_transit: Ошибка парсинга ТС: ' + e.message);
                }
            },
            failure: function () {
                Ext.log('passenger_transit: Не удалось загрузить ТС из PILOT');
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
                        online: item.state === 1
                    });
                }
            });
        }

        walk(groups);
        return vehicles;
    },

    // ==================== LOCAL STORAGE: МАРШРУТЫ ====================
    loadRoutesFromStorage: function () {
        try {
            var stored = localStorage.getItem('passenger_transit_routes');
            if (stored) {
                this.state.routes = Ext.decode(stored);
                Ext.log('passenger_transit: Загружено маршрутов из localStorage: ' + this.state.routes.length);
            }
        } catch (e) {
            Ext.log('passenger_transit: Ошибка загрузки из localStorage');
            this.state.routes = [];
        }
    },

    saveRoutesToStorage: function () {
        try {
            localStorage.setItem('passenger_transit_routes', Ext.encode(this.state.routes));
        } catch (e) {
            Ext.log('passenger_transit: Ошибка сохранения в localStorage');
        }
    },

    // ==================== ДЕЙСТВИЯ С МАРШРУТАМИ ====================
    createRoute: function (name) {
        var me = this;
        var newId = me.state.routes.length > 0 ? Math.max.apply(null, me.state.routes.map(function (r) { return r.id; })) + 1 : 1;
        me.state.routes.push({
            id: newId,
            name: name,
            vehicle_count: 0,
            stops: [],
            forward_points: [],
            backward_points: []
        });
        me.saveRoutesToStorage();
        me.refreshRouteTree();
        me.selectRoute(newId);
        Ext.toast({ html: l('Маршрут создан'), align: 't', timeout: 2000 });
    },

    addStop: function (routeId, stop) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (route) {
            route.stops.push({
                id: Date.now(),
                name: stop.name,
                lat: stop.lat,
                lon: stop.lon,
                order_index: route.stops.length
            });
            me.saveRoutesToStorage();
            me.selectRoute(routeId);
            Ext.toast({ html: l('Остановка добавлена'), align: 't', timeout: 2000 });
        }
    },

    saveRoutePoints: function (routeId, points, direction) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (route) {
            route[direction + '_points'] = points.map(function (p, i) {
                return { lat: p.lat, lon: p.lon, order_index: i };
            });
            me.saveRoutesToStorage();
            me.selectRoute(routeId);
            Ext.toast({ html: l('Маршрут сохранен'), align: 't', timeout: 2000 });
        }
    },

    getRouteById: function (routeId) {
        var found = null;
        Ext.each(this.state.routes, function (r) {
            if (r.id == routeId) { found = r; return false; }
        });
        return found;
    },

    // ==================== РАБОТА С КАРТОЙ PILOT ====================
    getPilotMap: function () {
        if (window.getActiveTabMapContainer) {
            return getActiveTabMapContainer();
        }
        return window.mapContainer || null;
    },

    drawRoute: function (routeId, forwardPoints, backwardPoints) {
        var map = this.getPilotMap();
        if (!map || !map.map) {
            Ext.log('passenger_transit: Карта PILOT недоступна');
            return;
        }
        var leafletMap = map.map;

        this.clearRoute(routeId);

        if (forwardPoints && forwardPoints.length > 1) {
            var line = L.polyline(forwardPoints.map(function (p) { return [p.lat, p.lon]; }), {
                color: '#2563eb', weight: 4, opacity: 0.85
            }).addTo(leafletMap);
            this.state.mapLayers.routes[routeId + '_forward'] = line;
        }
        if (backwardPoints && backwardPoints.length > 1) {
            var line = L.polyline(backwardPoints.map(function (p) { return [p.lat, p.lon]; }), {
                color: '#dc2626', weight: 4, opacity: 0.85, dashArray: '8, 6'
            }).addTo(leafletMap);
            this.state.mapLayers.routes[routeId + '_backward'] = line;
        }
    },

    drawStops: function (routeId, stops) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        var leafletMap = map.map;

        this.clearStops(routeId);
        var me = this;
        stops.forEach(function (stop, index) {
            var icon = L.divIcon({
                className: 'pt-stop-marker',
                html: '<div class="pt-stop-number">' + (index + 1) + '</div>',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
            var marker = L.marker([stop.lat, stop.lon], { icon: icon, title: stop.name }).addTo(leafletMap);
            marker.bindPopup('<b>' + Ext.String.htmlEncode(stop.name) + '</b>');
            if (!me.state.mapLayers.stops[routeId]) me.state.mapLayers.stops[routeId] = [];
            me.state.mapLayers.stops[routeId].push(marker);
        });
    },

    drawVehiclesForSelectedRoute: function () {
        var me = this;
        if (!me.state.selectedRoute) return;
        
        // Для демонстрации рисуем все ТС из PILOT
        // В реальном проекте здесь фильтрация по привязанным ТС
        var vehicles = me.state.pilotVehicles.slice(0, 10); // Первые 10 ТС
        me.drawVehicles(me.state.selectedRoute, vehicles);
    },

    drawVehicles: function (routeId, vehicles) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        var leafletMap = map.map;

        this.clearVehicles(routeId);
        var me = this;
        vehicles.forEach(function (veh) {
            if (!veh.lat || !veh.lon) return;
            
            var icon = L.divIcon({
                className: 'pt-vehicle-marker',
                html: '<div class="pt-vehicle-icon"><i class="fa fa-bus"></i></div>' +
                      '<div class="pt-vehicle-number">' + Ext.String.htmlEncode(veh.number || '') + '</div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });
            var marker = L.marker([veh.lat, veh.lon], { icon: icon, title: veh.number }).addTo(leafletMap);
            marker.on('click', function () {
                Ext.Msg.alert(l('ТС'), l('Номер: ') + veh.number + '<br>' + l('Группа: ') + veh.group);
            });
            if (!me.state.mapLayers.vehicles[routeId]) me.state.mapLayers.vehicles[routeId] = [];
            me.state.mapLayers.vehicles[routeId].push(marker);
        });
    },

    clearRoute: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        var leafletMap = map.map;
        ['forward', 'backward'].forEach(function (dir) {
            var key = routeId + '_' + dir;
            if (this.state.mapLayers.routes[key]) {
                leafletMap.removeLayer(this.state.mapLayers.routes[key]);
                delete this.state.mapLayers.routes[key];
            }
        }.bind(this));
    },

    clearStops: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        var leafletMap = map.map;
        if (this.state.mapLayers.stops[routeId]) {
            this.state.mapLayers.stops[routeId].forEach(function (m) { leafletMap.removeLayer(m); });
            delete this.state.mapLayers.stops[routeId];
        }
    },

    clearVehicles: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        var leafletMap = map.map;
        if (this.state.mapLayers.vehicles[routeId]) {
            this.state.mapLayers.vehicles[routeId].forEach(function (m) { leafletMap.removeLayer(m); });
            delete this.state.mapLayers.vehicles[routeId];
        }
    },

    selectRoute: function (routeId) {
        var me = this;
        me.state.selectedRoute = routeId;
        var route = me.getRouteById(routeId);
        if (!route) return;

        me.drawRoute(routeId, route.forward_points, route.backward_points);
        if (route.stops && route.stops.length > 0) me.drawStops(routeId, route.stops);
        me.drawVehiclesForSelectedRoute();
    },

    // ==================== РЕДАКТОР МАРШРУТА ====================
    enableRouteEditMode: function (routeId, direction) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) {
            Ext.Msg.alert(l('Ошибка'), l('Карта PILOT недоступна'));
            return;
        }
        var leafletMap = map.map;

        me.state.routeEditMode = true;
        me.state.selectedRoute = routeId;
        me.state.editDirection = direction || 'forward';
        me.state.editingRoutePoints = { forward: [], backward: [] };

        var route = me.getRouteById(routeId);
        if (route && route[direction + '_points']) {
            me.state.editingRoutePoints[direction] = Ext.Array.clone(route[direction + '_points']);
        }

        me._routeEditClickHandler = function (e) {
            if (!me.state.routeEditMode) return;
            var point = {
                lat: e.latlng.lat,
                lon: e.latlng.lng,
                order_index: me.state.editingRoutePoints[me.state.editDirection].length
            };
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
        Ext.toast({ html: l('Кликайте по карте. Правый клик - завершить.'), align: 't', timeout: 4000 });
    },

    drawEditingPolyline: function () {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;
        var leafletMap = map.map;

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
        var polyline = L.polyline(latlngs, {
            color: color, weight: 5, opacity: 0.9,
            dashArray: dir === 'backward' ? '8, 6' : null
        }).addTo(leafletMap);
        me.state.mapLayers.editingPolyline = polyline;

        points.forEach(function (p, index) {
            var marker = L.circleMarker([p.lat, p.lon], {
                radius: 6, fillColor: color, color: '#fff', weight: 2
            }).addTo(leafletMap);
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
        var map = me.getPilotMap();
        if (map && map.map) {
            var leafletMap = map.map;
            if (me._routeEditClickHandler) leafletMap.off('click', me._routeEditClickHandler);
            if (me._routeEditRightClickHandler) leafletMap.off('contextmenu', me._routeEditRightClickHandler);
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
                dock: 'top',
                cls: 'pt-edit-toolbar',
                renderTo: Ext.getBody(),
                floating: true,
                x: 400,
                y: 100,
                items: [
                    { text: l('Завершить'), iconCls: 'fa fa-check', handler: me.finishRouteEditing, scope: me },
                    { text: l('Отмена'), iconCls: 'fa fa-times', handler: me.disableRouteEditMode, scope: me },
                    '-',
                    {
                        text: l('Удалить посл.'), iconCls: 'fa fa-undo',
                        handler: function () {
                            me.state.editingRoutePoints[me.state.editDirection].pop();
                            me.drawEditingPolyline();
                            me.updateEditToolbarStats();
                        }, scope: me
                    },
                    { xtype: 'tbtext', text: l('Точек: 0') }
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
        var textItem = me.editToolbar.down('tbtext');
        if (textItem) textItem.setText(l('Точек: ') + me.state.editingRoutePoints[me.state.editDirection].length);
    },

    // ==================== РЕДАКТОР ОСТАНОВОК ====================
    enableEditMode: function () {
        var me = this;
        if (me.state.routeEditMode) {
            Ext.Msg.alert(l('Внимание'), l('Сначала завершите рисование маршрута'));
            return;
        }
        var map = me.getPilotMap();
        if (!map || !map.map) {
            Ext.Msg.alert(l('Ошибка'), l('Карта PILOT недоступна'));
            return;
        }
        var leafletMap = map.map;

        me.state.editMode = true;
        me._mapClickHandler = function (e) {
            if (!me.state.editMode || !me.state.selectedRoute) return;
            Ext.Msg.prompt(l('Новая остановка'), l('Название') + ':', function (btn, text) {
                if (btn === 'ok' && text) {
                    me.addStop(me.state.selectedRoute, {
                        name: text,
                        lat: e.latlng.lat,
                        lon: e.latlng.lng
                    });
                }
            }, this, false, '');
        };
        leafletMap.on('click', me._mapClickHandler);
        Ext.toast({ html: l('Кликните по карте для добавления остановки'), align: 't', timeout: 4000 });
    },

    disableEditMode: function () {
        var me = this;
        me.state.editMode = false;
        var map = me.getPilotMap();
        if (map && map.map && me._mapClickHandler) {
            map.map.off('click', me._mapClickHandler);
        }
    },

    refreshRouteTree: function () {
        var navTab = skeleton.navigation.items ? skeleton.navigation.items.getAt(0) : null;
        if (navTab && navTab.items) {
            var tree = navTab.items.getAt(0);
            if (tree && tree.loadRoutes) tree.loadRoutes(this.state.routes);
        }
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
            {
                text: l('Остановки'), iconCls: 'fa fa-edit',
                handler: function () {
                    if (me.module) {
                        if (me.module.state.editMode) me.module.disableEditMode();
                        else me.module.enableEditMode();
                    }
                }, scope: me
            },
            {
                text: l('Рисовать'), iconCls: 'fa fa-pencil',
                handler: function () {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) me.module.enableRouteEditMode(rec.data.route_id, 'forward');
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
            return {
                text: r.name,
                name: r.name,
                vehicle_count: r.vehicle_count || 0,
                route_id: r.id,
                leaf: true,
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
        Ext.Msg.prompt(l('Новый маршрут'), l('Название') + ':', function (btn, text) {
            if (btn === 'ok' && text && me.module) me.module.createRoute(text);
        }, this, false, '');
    }
});
