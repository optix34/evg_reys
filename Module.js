// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки
// Pattern A (Full UI) + Pattern C (Existing Map)
// Соответствует AI_SPECS.md

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
            tracks: {}
        },
        editMode: null, // 'forward_stops', 'backward_stops', 'forward_route', 'backward_route'
        editingRoute: null,
        editingPoints: { forward: [], backward: [] },
        editingStops: { forward: [], backward: [] }
    },

    getModuleBaseUrl: function () {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src || '';
            if (src.indexOf('/Module.js') !== -1) {
                return src.replace('Module.js', '');
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

        // Загрузка данных из localStorage
        me.loadFromLocalStorage();

        // Создание навигационной вкладки (Pattern A)
        var navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 400,
            items: [Ext.create('Store.passenger_transit.view.RouteTree', { module: me })]
        });

        // Создание основной панели
        var mainPanel = Ext.create('Store.passenger_transit.view.MainPanel', { module: me });
        
        // Связь вкладки и панели (обязательно по AI_SPECS.md)
        navTab.map_frame = mainPanel;

        // Интеграция с PILOT skeleton
        if (window.skeleton && skeleton.navigation && skeleton.mapframe) {
            skeleton.navigation.add(navTab);
            skeleton.mapframe.add(mainPanel);

            // Кнопка в хедер (Pattern E)
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

            // Загрузка реальных ТС из PILOT (AI_SPECS Rule 5)
            me.loadVehiclesFromPilot();
            me.refreshRouteTree();

            Ext.toast({ html: l('Модуль загружен'), align: 't', timeout: 2000 });
        } else {
            Ext.log('passenger_transit: skeleton not found');
        }
    },

    // ==================== РАБОТА С КАРТОЙ PILOT (Pattern C) ====================

    getPilotMap: function () {
        // AI_SPECS.md: использовать getActiveTabMapContainer() или mapContainer
        if (window.getActiveTabMapContainer) {
            return getActiveTabMapContainer();
        }
        return window.mapContainer || null;
    },

    // ==================== ЗАГРУЗКА ТС ИЗ PILOT (AI_SPECS Rule 5) ====================

    loadVehiclesFromPilot: function () {
        var me = this;
        Ext.Ajax.request({
            url: '/ax/tree.php',
            params: { vehs: 1, state: 1, lat: 1, lon: 1, dir: 1, speed: 1 },
            success: function (resp) {
                try {
                    var groups = Ext.decode(resp.responseText);
                    me.state.pilotVehicles = me.parsePilotTree(groups);
                    Ext.log('passenger_transit: Загружено ТС:', me.state.pilotVehicles.length);
                    
                    if (me.state.selectedRoute) {
                        me.drawVehicles(me.state.selectedRoute);
                    }
                } catch (e) {
                    Ext.log('passenger_transit: Ошибка парсинга ТС:', e);
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
                        id: String(item.id),
                        name: item.name,
                        number: item.number || item.name,
                        group: parentGroup || '',
                        lat: item.lat || 0,
                        lon: item.lon || 0,
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

    // ==================== LOCALSTORAGE ====================

    loadFromLocalStorage: function () {
        try {
            var data = localStorage.getItem('passenger_transit_routes');
            if (data) {
                this.state.routes = Ext.decode(data);
            }
        } catch (e) {
            Ext.log('passenger_transit: Ошибка загрузки из localStorage');
        }
    },

    saveToLocalStorage: function () {
        try {
            localStorage.setItem('passenger_transit_routes', Ext.encode(this.state.routes));
        } catch (e) {
            Ext.log('passenger_transit: Ошибка сохранения в localStorage');
        }
    },

    // ==================== CRUD МАРШРУТОВ ====================

    createRoute: function (number, name) {
        var me = this;
        var newId = me.state.routes.length > 0 ? Math.max.apply(null, me.state.routes.map(function(r){return r.id;})) + 1 : 1;
        me.state.routes.push({
            id: newId,
            number: number,
            name: name,
            vehicle_count: 0,
            forward_stops: [],
            backward_stops: [],
            forward_points: [],
            backward_points: [],
            vehicles: []
        });
        me.saveToLocalStorage();
        me.refreshRouteTree();
        me.selectRoute(newId);
        Ext.toast({ html: l('Маршрут создан'), align: 't', timeout: 2000 });
    },

    deleteRoute: function (routeId) {
        var me = this;
        me.state.routes = me.state.routes.filter(function(r) { return r.id !== routeId; });
        me.saveToLocalStorage();
        me.refreshRouteTree();
        if (me.state.selectedRoute === routeId) {
            me.state.selectedRoute = null;
            me.clearAllLayers();
        }
    },

    // ==================== РЕДАКТИРОВАНИЕ ОСТАНОВОК ====================

    startAddingStops: function (routeId, direction) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route) return;

        var map = me.getPilotMap();
        if (!map || !map.map) {
            Ext.Msg.alert('Ошибка', 'Карта PILOT недоступна. Убедитесь, что вы в разделе Online или History.');
            return;
        }

        me.state.editMode = direction + '_stops';
        me.state.editingRoute = route;
        me.state.editingStops = {
            forward: Ext.Array.clone(route.forward_stops || []),
            backward: Ext.Array.clone(route.backward_stops || [])
        };

        me._stopClickHandler = function (e) {
            if (!me.state.editMode || me.state.editMode !== direction + '_stops') return;
            
            Ext.Msg.prompt(
                l('Новая остановка'),
                l('Название остановки') + ':',
                function (btn, text) {
                    if (btn === 'ok' && text) {
                        var stop = {
                            id: Date.now(),
                            name: text,
                            lat: e.latlng.lat,
                            lon: e.latlng.lng
                        };
                        me.state.editingStops[direction].push(stop);
                        me.drawEditingStops(direction);
                        Ext.toast({ html: l('Остановка добавлена'), align: 't', timeout: 1500 });
                    }
                },
                this,
                false,
                ''
            );
        };

        map.map.on('click', me._stopClickHandler);
        me.drawEditingStops(direction);
        me.showStopEditToolbar(direction);

        Ext.toast({ 
            html: l('Кликайте по карте для добавления остановок ') + direction + ' направления', 
            align: 't', 
            timeout: 4000 
        });
    },

    drawEditingStops: function (direction) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me.clearEditingStops();

        var stops = me.state.editingStops[direction];
        stops.forEach(function (stop, index) {
            var icon = L.divIcon({
                className: 'pt-stop-marker pt-stop-editing',
                html: '<div class="pt-stop-number">' + (index + 1) + '</div>',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            var marker = L.marker([stop.lat, stop.lon], { icon: icon }).addTo(map.map);
            marker.bindPopup('<b>' + Ext.String.htmlEncode(stop.name) + '</b><br/>' + l('Остановка') + ' #' + (index + 1));
            
            if (!me.state.mapLayers.editingStops) me.state.mapLayers.editingStops = [];
            me.state.mapLayers.editingStops.push(marker);
        });
    },

    clearEditingStops: function () {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        if (this.state.mapLayers.editingStops) {
            this.state.mapLayers.editingStops.forEach(function (m) { map.map.removeLayer(m); });
            this.state.mapLayers.editingStops = [];
        }
    },

    finishAddingStops: function (direction) {
        var me = this;
        if (!me.state.editMode || me.state.editMode !== direction + '_stops') return;

        var route = me.state.editingRoute;
        if (route) {
            route[direction + '_stops'] = Ext.Array.clone(me.state.editingStops[direction]);
            me.saveToLocalStorage();
            me.selectRoute(route.id);
            Ext.toast({ html: l('Остановки сохранены'), align: 't', timeout: 2000 });
        }

        me.stopEditingStops();
    },

    cancelAddingStops: function () {
        this.stopEditingStops();
    },

    stopEditingStops: function () {
        var me = this;
        var map = me.getPilotMap();
        if (map && map.map && me._stopClickHandler) {
            map.map.off('click', me._stopClickHandler);
        }
        me.clearEditingStops();
        me.state.editMode = null;
        me.state.editingRoute = null;
        me.state.editingStops = { forward: [], backward: [] };
        me.hideStopEditToolbar();
    },

    showStopEditToolbar: function (direction) {
        var me = this;
        var mainPanel = me.getMainPanel();
        if (!mainPanel) return;

        if (!me.stopEditToolbar) {
            me.stopEditToolbar = Ext.create('Ext.toolbar.Toolbar', {
                dock: 'top',
                cls: 'pt-edit-toolbar',
                items: [
                    { text: l('Завершить'), iconCls: 'fa fa-check', handler: function() { me.finishAddingStops(direction); }, scope: me },
                    { text: l('Отмена'), iconCls: 'fa fa-times', handler: me.cancelAddingStops, scope: me },
                    '-',
                    { text: l('Удалить последнюю'), iconCls: 'fa fa-undo', handler: function() {
                        me.state.editingStops[direction].pop();
                        me.drawEditingStops(direction);
                    }, scope: me }
                ]
            });
            mainPanel.insert(0, me.stopEditToolbar);
        }
        me.stopEditToolbar.show();
    },

    hideStopEditToolbar: function () {
        if (this.stopEditToolbar) this.stopEditToolbar.hide();
    },

    // ==================== РИСОВАНИЕ МАРШРУТА ====================

    startDrawingRoute: function (routeId, direction) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route) return;

        var map = me.getPilotMap();
        if (!map || !map.map) {
            Ext.Msg.alert('Ошибка', 'Карта PILOT недоступна');
            return;
        }

        me.state.editMode = direction + '_route';
        me.state.editingRoute = route;
        me.state.editingPoints = {
            forward: Ext.Array.clone(route.forward_points || []),
            backward: Ext.Array.clone(route.backward_points || [])
        };

        me._routeClickHandler = function (e) {
            if (!me.state.editMode || me.state.editMode !== direction + '_route') return;
            
            var point = {
                lat: e.latlng.lat,
                lon: e.latlng.lng,
                order_index: me.state.editingPoints[direction].length
            };
            me.state.editingPoints[direction].push(point);
            me.drawEditingRoute(direction);
            Ext.toast({ html: l('Точка добавлена') + ' #' + point.order_index, align: 't', timeout: 1500 });
        };

        me._routeRightClickHandler = function (e) {
            if (!me.state.editMode || me.state.editMode !== direction + '_route') return;
            if (e.originalEvent) e.originalEvent.preventDefault();
            me.finishDrawingRoute(direction);
        };

        map.map.on('click', me._routeClickHandler);
        map.map.on('contextmenu', me._routeRightClickHandler);
        me.drawEditingRoute(direction);
        me.showRouteEditToolbar(direction);

        Ext.toast({ 
            html: l('Кликайте для добавления точек. Правый клик - завершить.'), 
            align: 't', 
            timeout: 4000 
        });
    },

    drawEditingRoute: function (direction) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me.clearEditingRoute();

        var points = me.state.editingPoints[direction];
        if (points.length === 0) return;

        var latlngs = points.map(function (p) { return [p.lat, p.lon]; });
        var color = direction === 'forward' ? '#2563eb' : '#dc2626';
        var dashArray = direction === 'backward' ? '8, 6' : null;

        var polyline = L.polyline(latlngs, { color: color, weight: 5, opacity: 0.9, dashArray: dashArray }).addTo(map.map);
        me.state.mapLayers.editingRoute = polyline;

        points.forEach(function (p, index) {
            var marker = L.circleMarker([p.lat, p.lon], { radius: 6, fillColor: color, color: '#fff', weight: 2 }).addTo(map.map);
            if (!me.state.mapLayers.editingPoints) me.state.mapLayers.editingPoints = [];
            me.state.mapLayers.editingPoints.push(marker);
        });
    },

    clearEditingRoute: function () {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        if (this.state.mapLayers.editingRoute) {
            map.map.removeLayer(this.state.mapLayers.editingRoute);
            this.state.mapLayers.editingRoute = null;
        }
        if (this.state.mapLayers.editingPoints) {
            this.state.mapLayers.editingPoints.forEach(function (m) { map.map.removeLayer(m); });
            this.state.mapLayers.editingPoints = [];
        }
    },

    finishDrawingRoute: function (direction) {
        var me = this;
        if (!me.state.editMode || me.state.editMode !== direction + '_route') return;

        var points = me.state.editingPoints[direction];
        if (points.length < 2) {
            Ext.Msg.alert('Ошибка', 'Минимум 2 точки');
            return;
        }

        Ext.Msg.confirm(l('Сохранение'), l('Точек: ') + points.length + '. ' + l('Сохранить?'), function (btn) {
            if (btn === 'yes') {
                var route = me.state.editingRoute;
                if (route) {
                    route[direction + '_points'] = points.map(function(p, i) {
                        return { lat: p.lat, lon: p.lon, order_index: i };
                    });
                    me.saveToLocalStorage();
                    me.selectRoute(route.id);
                    Ext.toast({ html: l('Маршрут сохранен'), align: 't', timeout: 2000 });
                }
            }
            me.stopDrawingRoute();
        });
    },

    cancelDrawingRoute: function () {
        this.stopDrawingRoute();
    },

    stopDrawingRoute: function () {
        var me = this;
        var map = me.getPilotMap();
        if (map && map.map) {
            if (me._routeClickHandler) map.map.off('click', me._routeClickHandler);
            if (me._routeRightClickHandler) map.map.off('contextmenu', me._routeRightClickHandler);
        }
        me.clearEditingRoute();
        me.state.editMode = null;
        me.state.editingRoute = null;
        me.state.editingPoints = { forward: [], backward: [] };
        me.hideRouteEditToolbar();
    },

    showRouteEditToolbar: function (direction) {
        var me = this;
        var mainPanel = me.getMainPanel();
        if (!mainPanel) return;

        if (!me.routeEditToolbar) {
            me.routeEditToolbar = Ext.create('Ext.toolbar.Toolbar', {
                dock: 'top',
                cls: 'pt-edit-toolbar',
                items: [
                    { text: l('Завершить'), iconCls: 'fa fa-check', handler: function() { me.finishDrawingRoute(direction); }, scope: me },
                    { text: l('Отмена'), iconCls: 'fa fa-times', handler: me.cancelDrawingRoute, scope: me },
                    '-',
                    { text: l('Удалить последнюю'), iconCls: 'fa fa-undo', handler: function() {
                        me.state.editingPoints[direction].pop();
                        me.drawEditingRoute(direction);
                    }, scope: me }
                ]
            });
            mainPanel.insert(0, me.routeEditToolbar);
        }
        me.routeEditToolbar.show();
    },

    hideRouteEditToolbar: function () {
        if (this.routeEditToolbar) this.routeEditToolbar.hide();
    },

    // ==================== ОТОБРАЖЕНИЕ НА КАРТЕ ====================

    drawRoute: function (routeId, forwardPoints, backwardPoints) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;

        this.clearRoute(routeId);

        if (forwardPoints && forwardPoints.length > 1) {
            var latlngs = forwardPoints.map(function (p) { return [p.lat, p.lon]; });
            var line = L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(map.map);
            this.state.mapLayers.routes[routeId + '_forward'] = line;
        }

        if (backwardPoints && backwardPoints.length > 1) {
            var latlngs = backwardPoints.map(function (p) { return [p.lat, p.lon]; });
            var line = L.polyline(latlngs, { color: '#dc2626', weight: 4, opacity: 0.85, dashArray: '8, 6' }).addTo(map.map);
            this.state.mapLayers.routes[routeId + '_backward'] = line;
        }
    },

    drawStops: function (routeId, forwardStops, backwardStops) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;

        this.clearStops(routeId);
        var me = this;

        // Прямое направление
        if (forwardStops && forwardStops.length > 0) {
            forwardStops.forEach(function (stop, index) {
                var icon = L.divIcon({
                    className: 'pt-stop-marker pt-stop-forward',
                    html: '<div class="pt-stop-number">' + (index + 1) + '</div>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });

                var marker = L.marker([stop.lat, stop.lon], { icon: icon }).addTo(map.map);
                marker.bindPopup('<b>' + Ext.String.htmlEncode(stop.name) + '</b><br/>' + l('Остановка') + ' #' + (index + 1));
                
                if (!me.state.mapLayers.stops[routeId]) me.state.mapLayers.stops[routeId] = [];
                me.state.mapLayers.stops[routeId].push(marker);
            });
        }

        // Обратное направление
        if (backwardStops && backwardStops.length > 0) {
            backwardStops.forEach(function (stop, index) {
                var icon = L.divIcon({
                    className: 'pt-stop-marker pt-stop-backward',
                    html: '<div class="pt-stop-number">' + (backwardStops.length - index) + '</div>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });

                var marker = L.marker([stop.lat, stop.lon], { icon: icon }).addTo(map.map);
                marker.bindPopup('<b>' + Ext.String.htmlEncode(stop.name) + '</b><br/>' + l('Остановка') + ' #' + (backwardStops.length - index));
                
                if (!me.state.mapLayers.stops[routeId]) me.state.mapLayers.stops[routeId] = [];
                me.state.mapLayers.stops[routeId].push(marker);
            });
        }
    },

    drawVehicles: function (routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;

        this.clearVehicles(routeId);
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route || !route.vehicles) return;

        route.vehicles.forEach(function (vehId) {
            var vehicle = me.state.pilotVehicles.find(function (v) { return v.id === vehId; });
            if (!vehicle) return;

            var icon = L.divIcon({
                className: 'pt-vehicle-marker',
                html: '<div class="pt-vehicle-icon"><i class="fa fa-bus"></i></div><div class="pt-vehicle-number">' + Ext.String.htmlEncode(vehicle.number) + '</div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });

            var marker = L.marker([vehicle.lat, vehicle.lon], { icon: icon }).addTo(map.map);
            marker.on('click', function () {
                me.selectVehicle(vehicle.id, routeId);
            });

            if (!me.state.mapLayers.vehicles[routeId]) me.state.mapLayers.vehicles[routeId] = [];
            me.state.mapLayers.vehicles[routeId].push(marker);
        });
    },

    clearRoute: function (routeId) {
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

    clearAllLayers: function () {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        var me = this;
        Object.keys(me.state.mapLayers).forEach(function (key) {
            if (key !== 'editingStops' && key !== 'editingRoute' && key !== 'editingPoints') {
                var layer = me.state.mapLayers[key];
                if (layer && layer.map) {
                    Object.keys(layer).forEach(function (layerKey) {
                        if (layer[layerKey] && layer[layerKey].remove) {
                            map.map.removeLayer(layer[layerKey]);
                        }
                    });
                }
                me.state.mapLayers[key] = {};
            }
        });
    },

    // ==================== ВЫБОР МАРШРУТА И ТС ====================

    selectRoute: function (routeId) {
        var me = this;
        me.state.selectedRoute = routeId;
        var route = me.getRouteById(routeId);
        if (!route) return;

        me.drawRoute(routeId, route.forward_points, route.backward_points);
        me.drawStops(routeId, route.forward_stops, route.backward_stops);
        me.drawVehicles(routeId);

        var mainPanel = me.getMainPanel();
        if (mainPanel && mainPanel.memoPanel) mainPanel.memoPanel.loadRoute(route);
        if (mainPanel && mainPanel.timelinePanel) mainPanel.timelinePanel.renderChart(me.getTimeline());
    },

    selectVehicle: function (vehicleId, routeId) {
        var me = this;
        Ext.Msg.alert(l('ТС'), l('ТС выбрано') + ': ' + vehicleId);
    },

    // ==================== ПРИВЯЗКА ТС ====================

    bindVehicles: function (routeId) {
        var me = this;
        var route = me.getRouteById(routeId);
        if (!route) return;

        var boundVehicles = route.vehicles || [];
        var availableVehicles = me.state.pilotVehicles.filter(function (v) {
            return boundVehicles.indexOf(v.id) === -1;
        });

        var win = Ext.create('Ext.window.Window', {
            title: l('Привязка ТС к маршруту') + ' - ' + route.number + ' ' + route.name,
            width: 800,
            height: 500,
            layout: 'border',
            modal: true,
            items: [
                {
                    region: 'west',
                    title: l('Доступные ТС'),
                    width: 380,
                    split: true,
                    layout: 'fit',
                    items: [{
                        xtype: 'grid',
                        store: Ext.create('Ext.data.Store', {
                            fields: ['id', 'name', 'number', 'group', 'online'],
                            data: availableVehicles
                        }),
                        columns: [
                            { text: l('ТС'), dataIndex: 'number', flex: 1 },
                            { text: l('Группа'), dataIndex: 'group', width: 150 }
                        ],
                        selModel: { selType: 'checkboxmodel' }
                    }]
                },
                {
                    region: 'center',
                    title: l('Привязанные ТС'),
                    layout: 'fit',
                    items: [{
                        xtype: 'grid',
                        store: Ext.create('Ext.data.Store', {
                            fields: ['id', 'number'],
                            data: boundVehicles.map(function (vid) {
                                var v = me.state.pilotVehicles.find(function (pv) { return pv.id === vid; });
                                return v ? { id: v.id, number: v.number } : null;
                            }).filter(function (v) { return v !== null; })
                        }),
                        columns: [
                            { text: l('ТС'), dataIndex: 'number', flex: 1 }
                        ],
                        tbar: [{
                            text: l('Удалить'),
                            iconCls: 'fa fa-trash',
                            handler: function () {
                                var grid = this.up('grid');
                                var sel = grid.getSelectionModel().getSelection();
                                if (sel.length > 0) {
                                    grid.getStore().remove(sel);
                                }
                            }
                        }]
                    }]
                }
            ],
            buttons: [
                {
                    text: l('Привязать выбранные'),
                    iconCls: 'fa fa-link',
                    handler: function () {
                        var leftGrid = win.down('region[region=west] grid');
                        var sel = leftGrid.getSelectionModel().getSelection();
                        if (sel.length === 0) {
                            Ext.Msg.alert(l('Внимание'), l('Выберите ТС'));
                            return;
                        }

                        var rightGrid = win.down('region[center] grid');
                        var rightStore = rightGrid.getStore();

                        sel.forEach(function (record) {
                            rightStore.add({ id: record.get('id'), number: record.get('number') });
                        });

                        leftGrid.getSelectionModel().deselectAll();
                    }
                },
                {
                    text: l('Сохранить'),
                    iconCls: 'fa fa-save',
                    handler: function () {
                        var rightGrid = win.down('region[center] grid');
                        var rightStore = rightGrid.getStore();
                        var vehicleIds = rightStore.getRange().map(function (r) { return r.get('id'); });

                        route.vehicles = vehicleIds;
                        route.vehicle_count = vehicleIds.length;
                        me.saveToLocalStorage();
                        me.selectRoute(routeId);
                        me.refreshRouteTree();

                        win.close();
                        Ext.toast({ html: l('ТС привязаны'), align: 't', timeout: 2000 });
                    }
                },
                { text: l('Отмена'), handler: function () { win.close(); } }
            ]
        });

        win.show();
    },

    // ==================== HELPERS ====================

    getRouteById: function (routeId) {
        var found = null;
        Ext.each(this.state.routes, function (r) { if (r.id == routeId) { found = r; return false; } });
        return found;
    },

    getMainPanel: function () {
        if (skeleton.mapframe) return skeleton.mapframe.items && skeleton.mapframe.items.getAt ? skeleton.mapframe.items.getAt(0) : null;
        return null;
    },

    getTimeline: function () {
        var hours = [], trips = [];
        for (var h = 6; h <= 22; h++) {
            hours.push(h + ':00');
            trips.push(h >= 7 && h <= 9 || h >= 17 && h <= 19 ? Math.floor(Math.random() * 5) + 3 : Math.floor(Math.random() * 2));
        }
        return { hours: hours, trips: trips };
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
            { text: l('Добавить'), iconCls: 'fa fa-plus', handler: me.onAddRoute, scope: me }
        ];
        me.columns = [
            { xtype: 'treecolumn', text: l('Маршрут'), dataIndex: 'display', flex: 1 },
            { text: l('ТС'), dataIndex: 'vehicle_count', width: 50, align: 'center' }
        ];
        me.listeners = { itemclick: me.onRouteClick, itemcontextmenu: me.onRouteContextMenu, scope: me };
        me.callParent(arguments);
    },
    loadRoutes: function (routes) {
        var me = this;
        var children = routes.map(function (r) {
            return {
                text: r.display || (r.number + ' ' + r.name),
                display: r.number + ' ' + r.name,
                name: r.name,
                number: r.number,
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
        if (this.module && record.data.route_id) this.module.selectRoute(record.data.route_id);
    },
    onRouteContextMenu: function (view, record, item, index, e) {
        e.stopEvent();
        var me = this;
        var menu = Ext.create('Ext.menu.Menu', {
            items: [
                { text: l('Добавить остановки (прямое)'), iconCls: 'fa fa-arrow-right', handler: function() { me.module.startAddingStops(record.data.route_id, 'forward'); } },
                { text: l('Добавить остановки (обратное)'), iconCls: 'fa fa-arrow-left', handler: function() { me.module.startAddingStops(record.data.route_id, 'backward'); } },
                '-',
                { text: l('Рисовать маршрут (прямое)'), iconCls: 'fa fa-pencil', handler: function() { me.module.startDrawingRoute(record.data.route_id, 'forward'); } },
                { text: l('Рисовать маршрут (обратное)'), iconCls: 'fa fa-pencil', handler: function() { me.module.startDrawingRoute(record.data.route_id, 'backward'); } },
                '-',
                { text: l('Привязать ТС'), iconCls: 'fa fa-bus', handler: function() { me.module.bindVehicles(record.data.route_id); } },
                '-',
                { text: l('Удалить маршрут'), iconCls: 'fa fa-trash', handler: function() {
                    Ext.Msg.confirm(l('Удаление'), l('Удалить маршрут') + '?', function(btn) {
                        if (btn === 'yes') me.module.deleteRoute(record.data.route_id);
                    });
                }}
            ]
        });
        menu.showAt(e.getXY());
    },
    onAddRoute: function () {
        var me = this;
        var win = Ext.create('Ext.window.Window', {
            title: l('Новый маршрут'),
            width: 400,
            height: 200,
            modal: true,
            layout: 'form',
            items: [
                { xtype: 'textfield', name: 'number', fieldLabel: l('Номер маршрута'), allowBlank: false, anchor: '100%' },
                { xtype: 'textfield', name: 'name', fieldLabel: l('Наименование'), allowBlank: false, anchor: '100%' }
            ],
            buttons: [
                {
                    text: l('Создать'),
                    iconCls: 'fa fa-plus',
                    handler: function () {
                        var form = win.down('form').getForm();
                        if (form.isValid()) {
                            var values = form.getValues();
                            me.module.createRoute(values.number, values.name);
                            win.close();
                        }
                    }
                },
                { text: l('Отмена'), handler: function () { win.close(); } }
            ]
        });
        win.show();
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
            { region: 'center', xtype: 'panel', cls: 'pt-map-placeholder', html: '<div class="pt-map-hint">' + l('Используйте карту PILOT. Выберите маршрут слева.') + '</div>' },
            Ext.create('Store.passenger_transit.view.RouteMemoPanel', {
                region: 'east', module: me.module, width: 320, split: true, collapsible: true, title: l('Мнемосхема'),
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
        if (!route) return '<div class="pt-memo-empty">' + l('Нет данных') + '</div>';
        
        var stops = direction === 'forward' ? (route.forward_stops || []) : (route.backward_stops || []);
        if (stops.length === 0) return '<div class="pt-memo-empty">' + l('Нет остановок') + '</div>';
        
        var html = '<div class="pt-memo-route">';
        html += '<div class="pt-memo-header">' + Ext.String.htmlEncode(route.number + ' ' + route.name) + '</div>';
        html += '<div class="pt-memo-stops">';
        
        stops.forEach(function (stop, index) {
            var isFwd = direction === 'forward';
            var num = isFwd ? (index + 1) : (stops.length - index);
            html += '<div class="pt-memo-stop ' + (isFwd ? 'pt-stop-forward' : 'pt-stop-backward') + '" data-index="' + index + '">';
            html += '<div class="pt-memo-stop-number">' + num + '</div>';
            html += '<div class="pt-memo-stop-name">' + Ext.String.htmlEncode(stop.name) + '</div></div>';
        });
        
        return html + '</div></div>';
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
