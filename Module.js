// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки
// Backend: Node.js на 37.139.99.253:3001
// Frontend: GitHub Pages

Ext.define('Store.passenger_transit.Module', {
    extend: 'Ext.Component',
    extensionName: 'passenger_transit',

    backendBaseUrl: 'https://saggy-return-aide.ngrok-free.dev',

    getBackendUrl: function(action) {
        return this.backendBaseUrl + '/api/' + action;
    },

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
        editDirection: 'forward',
        isTabActive: false  // Флаг активности вкладки
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

        // СОЗДАЕМ ДЕРЕВО МАРШРУТОВ И СОХРАНЯЕМ ССЫЛКУ
        me.routeTree = Ext.create('Store.passenger_transit.view.RouteTree', {
            module: me
        });

        // Create navigation tab (левая панель)
        me.navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 350,
            items: [
                me.routeTree
            ]
        });

        // ВАЖНО: НЕ устанавливаем map_frame, чтобы карта PILOT оставалась видимой
        // со всеми элементами управления (навигация, линейка, слои и т.д.)
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
            // При переключении на другую вкладку - скрываем плавающие панели
            // При возврате на вкладку "Рейсы" - показываем их обратно
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
            me.loadRoutes();
            me.loadVehiclesFromPilot();

            // Создаем плавающие панели после инициализации
            setTimeout(function() {
                me.createFloatingPanels();
                // Если вкладка активна сразу при старте - показываем панели
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
        if (me.memoWindow && !me.memoWindow.isVisible()) {
            me.memoWindow.show();
        }
        if (me.timelineWindow && !me.timelineWindow.isVisible()) {
            me.timelineWindow.show();
        }
    },

    hideFloatingPanels: function() {
        var me = this;
        if (me.memoWindow && me.memoWindow.isVisible()) {
            me.memoWindow.hide();
        }
        if (me.timelineWindow && me.timelineWindow.isVisible()) {
            me.timelineWindow.hide();
        }
    },

    createFloatingPanels: function() {
        var me = this;

        // СОЗДАЕМ МНЕМОСХЕМУ как плавающее окно
        me.memoPanel = Ext.create('Store.passenger_transit.view.RouteMemoPanel', {
            module: me
        });

        me.memoWindow = Ext.create('Ext.window.Window', {
            title: l('Мнемосхема'),
            width: 320,
            height: 500,
            x: window.innerWidth - 340,
            y: 100,
            collapsible: true,
            collapseDirection: 'right',
            closeAction: 'hide',  // При закрытии - скрывать, а не уничтожать
            layout: 'fit',
            cls: 'pt-floating-memo-panel',
            items: [me.memoPanel],
            listeners: {
                beforeclose: function(win) {
                    win.hide();
                    return false;  // Предотвращаем уничтожение окна
                }
            }
        });

        // СОЗДАЕМ ГРАФИК РЕЙСОВ как плавающее окно
        me.timelinePanel = Ext.create('Store.passenger_transit.view.TimelinePanel', {
            module: me
        });

        me.timelineWindow = Ext.create('Ext.window.Window', {
            title: l('График рейсов'),
            width: 600,
            height: 250,
            x: (window.innerWidth - 620) / 2,
            y: window.innerHeight - 270,
            collapsible: true,
            collapseDirection: 'down',
            closeAction: 'hide',
            layout: 'fit',
            cls: 'pt-floating-timeline-panel',
            items: [me.timelinePanel],
            listeners: {
                beforeclose: function(win) {
                    win.hide();
                    return false;
                }
            }
        });

        // Добавляем кнопки управления в нижнюю часть дерева маршрутов
        if (me.routeTree) {
            me.routeTree.addDocked({
                xtype: 'toolbar',
                dock: 'bottom',
                items: [
                    {
                        text: l('Мнемосхема'),
                        iconCls: 'fa fa-list',
                        enableToggle: true,
                        pressed: true,
                        toggleHandler: function(btn, pressed) {
                            if (pressed) {
                                me.memoWindow.show();
                            } else {
                                me.memoWindow.hide();
                            }
                        }
                    },
                    {
                        text: l('График'),
                        iconCls: 'fa fa-chart-bar',
                        enableToggle: true,
                        pressed: true,
                        toggleHandler: function(btn, pressed) {
                            if (pressed) {
                                me.timelineWindow.show();
                            } else {
                                me.timelineWindow.hide();
                            }
                        }
                    }
                ]
            });
        }
    },

    // ==================== PILOT API INTEGRATION ====================

    loadVehiclesFromPilot: function () {
        var me = this;
        Ext.Ajax.request({
            url: '/ax/tree.php',
            params: {
                vehs: 1,
                state: 1,
                lat: 1,
                lon: 1,
                dir: 1,
                speed: 1
            },
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

    // ==================== BACKEND API CALLS ====================

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
                if (data.success) {
                    me.loadRoutes();
                }
            }
        });
    },

    addStop: function (routeId, stop) {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('stops'),
            method: 'POST',
            jsonData: { route_id: routeId, stop: stop },
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    me.selectRoute(routeId);
                }
            }
        });
    },

    saveRoutePoints: function (routeId, points, direction) {
        var me = this;
        Ext.Ajax.request({
            url: me.getBackendUrl('route-points'),
            method: 'POST',
            jsonData: {
                route_id: routeId,
                direction: direction,
                points: points
            },
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

    getRouteVehicles: function (routeId) {
        var me = this;
        var vehicles = [];
        Ext.Ajax.request({
            url: me.getBackendUrl('vehicles/' + routeId),
            method: 'GET',
            async: false,
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    vehicles = data.vehicles || [];
                }
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
                if (data.success) {
                    Ext.toast({ html: l('ТС привязано'), align: 'br', timeout: 2000 });
                }
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
        Ext.Ajax.request({
            url: me.getBackendUrl('trips/track'),
            method: 'GET',
            params: { vehicle_id: vehicleId, route_id: routeId },
            async: false,
            success: function (resp) {
                var data = Ext.decode(resp.responseText);
                if (data.success) {
                    trackPoints = data.track || [];
                }
            }
        });
        return trackPoints;
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
                if (data.success) {
                    timeline = data.timeline || { hours: [], trips: [] };
                }
            }
        });
        return timeline;
    },

    // ==================== ROUTE EDITOR ====================

    enableRouteEditMode: function (routeId, direction) {
        var me = this;
        me.state.routeEditMode = true;
        me.state.selectedRoute = routeId;
        me.state.editType = 'route';
        me.state.editingRoutePoints = {
            forward: [],
            backward: []
        };

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
                lat: e.latlng.lat,
                lon: e.latlng.lng,
                order_index: me.state.editingRoutePoints[me.state.editDirection || 'forward'].length
            };
            me.state.editingRoutePoints[me.state.editDirection || 'forward'].push(point);
            me.drawEditingPolyline();
            me.updateEditToolbarStats();
            Ext.toast({
                html: l('Добавлена точка') + ' #' + point.order_index,
                align: 'br',
                timeout: 2000
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
            align: 't',
            timeout: 8000
        });
    },

    drawEditingPolyline: function () {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        if (me.state.mapLayers.editingPolyline) {
            map.map.removeLayer(me.state.mapLayers.editingPolyline);
        }
        if (me.state.mapLayers.editingPoints && me.state.mapLayers.editingPoints.length > 0) {
            me.state.mapLayers.editingPoints.forEach(function (m) {
                map.map.removeLayer(m);
            });
            me.state.mapLayers.editingPoints = [];
        }

        var direction = me.state.editDirection || 'forward';
        var points = me.state.editingRoutePoints[direction];
        if (points.length === 0) return;

        var latlngs = points.map(function (p) { return [p.lat, p.lon || p.lng]; });
        var color = direction === 'forward' ? '#2563eb' : '#dc2626';
        var dashArray = direction === 'forward' ? null : '8, 6';

        var polyline = L.polyline(latlngs, {
            color: color,
            weight: 5,
            opacity: 0.9,
            dashArray: dashArray
        }).addTo(map.map);
        me.state.mapLayers.editingPolyline = polyline;

        points.forEach(function (p, index) {
            var marker = L.circleMarker([p.lat, p.lon], {
                radius: 6,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9
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
                if (btn === 'yes') {
                    me.saveRoutePoints(routeId, points, me.state.editDirection || 'forward');
                }
                me.disableRouteEditMode();
            }
        );
    },

    disableRouteEditMode: function () {
        var me = this;
        me.state.routeEditMode = false;
        var map = me.getPilotMap();
        if (map && map.map) {
            if (me._routeEditClickHandler) {
                map.map.off('click', me._routeEditClickHandler);
            }
            if (me._routeEditRightClickHandler) {
                map.map.off('contextmenu', me._routeEditRightClickHandler);
            }
        }
        if (me.state.mapLayers.editingPolyline && map && map.map) {
            map.map.removeLayer(me.state.mapLayers.editingPolyline);
            me.state.mapLayers.editingPolyline = null;
        }
        if (me.state.mapLayers.editingPoints && map && map.map) {
            me.state.mapLayers.editingPoints.forEach(function (m) {
                map.map.removeLayer(m);
            });
            me.state.mapLayers.editingPoints = [];
        }
        me.hideRouteEditToolbar();
    },

    showRouteEditToolbar: function () {
        var me = this;

        if (!me.editToolbar) {
            me.editToolbar = Ext.create('Ext.toolbar.Toolbar', {
                cls: 'pt-edit-toolbar',
                floating: true,
                x: 100,
                y: 100,
                items: [
                    { text: l('Завершить'), iconCls: 'fa fa-check', handler: me.finishRouteEditing, scope: me },
                    { text: l('Отмена'), iconCls: 'fa fa-times', handler: me.disableRouteEditMode, scope: me },
                    '-',
                    {
                        text: l('Удалить последнюю'),
                        iconCls: 'fa fa-undo',
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
        if (this.editToolbar) {
            this.editToolbar.hide();
        }
    },

    updateEditToolbarStats: function () {
        var me = this;
        if (!me.editToolbar) return;
        var dir = me.state.editDirection || 'forward';
        var count = me.state.editingRoutePoints[dir].length;
        var textItem = me.editToolbar.down('tbtext');
        if (textItem) {
            textItem.setText(l('Точек: ') + count);
        }
    },

    // ==================== VEHICLE BINDING UI ====================

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
            width: 800,
            height: 500,
            layout: 'border',
            modal: true,
            cls: 'pt-vehicle-dialog',
            items: [
                {
                    region: 'west',
                    title: l('Доступные ТС (из PILOT)'),
                    width: 380,
                    split: true,
                    layout: 'fit',
                    items: [{
                        xtype: 'grid',
                        store: pilotStore,
                        columns: [
                            {
                                text: l('ТС'),
                                dataIndex: 'number',
                                flex: 1,
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
                            xtype: 'textfield',
                            emptyText: l('Поиск...'),
                            enableKeyEvents: true,
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
                    region: 'center',
                    title: l('Привязанные к маршруту'),
                    layout: 'fit',
                    items: [{
                        xtype: 'grid',
                        store: boundStore,
                        columns: [
                            { text: l('ТС'), dataIndex: 'vehicle_number', flex: 1 },
                            { text: l('ID'), dataIndex: 'vehicle_id', width: 100 }
                        ],
                        tbar: [{
                            text: l('Удалить'),
                            iconCls: 'fa fa-trash',
                            handler: function () {
                                var grid = this.up('grid');
                                var sel = grid.getSelectionModel().getSelection();
                                if (sel.length > 0) {
                                    Ext.each(sel, function (r) {
                                        me.unbindVehicle(route.id, r.get('vehicle_id'));
                                    });
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
                    text: l('Привязать выбранные'),
                    iconCls: 'fa fa-link',
                    handler: function () {
                        var leftGrid = win.down('region[region=west] grid');
                        var sel = leftGrid.getSelectionModel().getSelection();
                        if (sel.length === 0) {
                            Ext.Msg.alert(l('Внимание'), l('Выберите хотя бы одно ТС'));
                            return;
                        }
                        Ext.each(sel, function (r) {
                            me.bindVehicle(route.id, r.get('id'), r.get('number'));
                        });
                        setTimeout(function() {
                            boundStore.reload();
                            pilotStore.reload();
                            leftGrid.getSelectionModel().deselectAll();
                        }, 500);
                    }
                },
                { text: l('Закрыть'), handler: function () { win.close(); } }
            ]
        });
        win.show();
    },

    // ==================== MAP FUNCTIONS ====================

    getPilotMap: function () {
        if (window.getActiveTabMapContainer) {
            return getActiveTabMapContainer();
        }
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
            var icon = L.divIcon({
                className: 'pt-stop-marker',
                html: '<div class="pt-stop-number">' + (index + 1) + '</div>',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
            var marker = L.marker([stop.lat, stop.lon], { icon: icon, title: stop.name }).addTo(map.map);
            marker.bindPopup('<b>' + Ext.String.htmlEncode(stop.name) + '</b><br/>' + l('Остановка') + ' #' + (index + 1));
            marker.on('click', function () {
                if (me.state.selectedRoute && me.memoPanel) {
                    me.memoPanel.highlightStop(index);
                }
            });
            if (!me.state.mapLayers.stops[routeId]) {
                me.state.mapLayers.stops[routeId] = [];
            }
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
                html: '<div class="pt-vehicle-icon"><i class="fa fa-bus"></i></div>' +
                      '<div class="pt-vehicle-number">' + Ext.String.htmlEncode(veh.number || '') + '</div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });
            var marker = L.marker([veh.lat, veh.lon], { icon: icon, title: veh.number }).addTo(map.map);
            marker.on('click', function () { me.selectVehicle(veh.id, routeId); });
            if (!me.state.mapLayers.vehicles[routeId]) {
                me.state.mapLayers.vehicles[routeId] = [];
            }
            me.state.mapLayers.vehicles[routeId].push(marker);
        });
    },

    drawVehicleTrack: function (vehicleId, trackPoints) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        this.clearTrack(vehicleId);
        var points = trackPoints.map(function (p) { return [p.lat, p.lon || p.lng]; });
        if (points.length > 1) {
            var line = L.polyline(points, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map.map);
            this.state.mapLayers.tracks[vehicleId] = line;
            map.map.fitBounds(line.getBounds(), { padding: [50, 50] });
        }
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

    clearTrack: function (vehicleId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;
        if (this.state.mapLayers.tracks[vehicleId]) {
            map.map.removeLayer(this.state.mapLayers.tracks[vehicleId]);
            delete this.state.mapLayers.tracks[vehicleId];
        }
    },

    // ==================== DATA LOADING & SELECTION ====================

    selectRoute: function (routeId) {
        var me = this;
        me.state.selectedRoute = routeId;
        var route = me.getRouteById(routeId);
        if (!route) return;

        me.drawRoute(routeId, route.forward_points, route.backward_points);
        if (route.stops && route.stops.length > 0) {
            me.drawStops(routeId, route.stops);
        }

        var boundVehicles = me.getRouteVehicles(routeId);
        var enrichedVehicles = boundVehicles.map(function (v) {
            var pilotVeh = me.state.pilotVehicles.find(function (pv) { return pv.id === v.vehicle_id; });
            return Ext.apply({
                lat: pilotVeh ? pilotVeh.lat : 0,
                lon: pilotVeh ? pilotVeh.lon : 0,
                number: v.vehicle_number || (pilotVeh ? pilotVeh.number : 'N/A')
            }, v);
        });
        me.drawVehicles(routeId, enrichedVehicles);

        // Обновляем мнемосхему и график
        if (me.memoPanel) {
            me.memoPanel.loadRoute(route);
        }
        if (me.timelinePanel) {
            me.timelinePanel.renderChart(me.getTimeline(routeId));
        }
    },

    selectVehicle: function (vehicleId, routeId) {
        var me = this;
        me.state.selectedVehicle = vehicleId;
        var trackPoints = me.getVehicleTrack(vehicleId, routeId);
        me.drawVehicleTrack(vehicleId, trackPoints);
        Ext.Msg.alert(l('ТС') + ' ' + vehicleId, l('Выполнено рейсов') + ': <b>' + Math.floor(Math.random() * 5 + 3) + '</b>');
    },

    enableEditMode: function () {
        var me = this;
        if (me.state.routeEditMode) {
            Ext.Msg.alert(l('Внимание'), l('Сначала завершите редактирование маршрута'));
            return;
        }
        me.state.editMode = true;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me._mapClickHandler = function (e) {
            if (!me.state.editMode || !me.state.selectedRoute) return;
            Ext.Msg.prompt(
                l('Новая остановка'),
                l('Название остановки') + ':',
                function (btn, text) {
                    if (btn === 'ok' && text) {
                        me.addStop(me.state.selectedRoute, { name: text, lat: e.latlng.lat, lon: e.latlng.lng });
                    }
                },
                this, false, ''
            );
        };
        map.map.on('click', me._mapClickHandler);
        Ext.toast({ html: l('Кликните по карте для добавления остановки'), align: 't', timeout: 5000 });
    },

    disableEditMode: function () {
        var me = this;
        me.state.editMode = false;
        var map = me.getPilotMap();
        if (map && map.map && me._mapClickHandler) {
            map.map.off('click', me._mapClickHandler);
        }
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
        if (me.routeTree) {
            me.routeTree.loadRoutes(me.state.routes);
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
        me.store = Ext.create('Ext.data.TreeStore', {
            root: { expanded: true, children: [] }
        });

        me.tbar = [
            {
                text: l('Добавить маршрут'),
                iconCls: 'fa fa-plus',
                handler: me.onAddRoute,
                scope: me
            },
            {
                text: l('Редактировать'),
                iconCls: 'fa fa-edit',
                handler: me.onToggleEdit,
                scope: me,
                itemId: 'editBtn'
            },
            {
                text: l('Рисовать маршрут'),
                iconCls: 'fa fa-pencil',
                handler: function() {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) {
                        me.module.enableRouteEditMode(rec.data.route_id, 'forward');
                    } else {
                        Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
                    }
                },
                scope: me
            },
            '-',
            {
                text: l('Привязать ТС'),
                iconCls: 'fa fa-link',
                handler: function() {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) {
                        me.module.showVehicleBindingDialog(rec.data.route_id);
                    } else {
                        Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
                    }
                },
                scope: me
            }
        ];

        me.columns = [
            { xtype: 'treecolumn', text: l('Маршрут'), dataIndex: 'name', flex: 1 },
            { text: l('ТС'), dataIndex: 'vehicle_count', width: 50, align: 'center' }
        ];

        me.listeners = {
            itemclick: me.onRouteClick,
            scope: me
        };
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
                            if (data.success && me.module) {
                                Ext.toast({
                                    html: l('Маршрут "') + routeName + l('" создан'),
                                    align: 't',
                                    timeout: 3000
                                });
                                me.module.loadRoutes();
                            } else {
                                Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось создать маршрут'));
                            }
                        },
                        failure: function (resp) {
                            var errorMsg = l('Ошибка соединения с сервером');
                            try {
                                var data = Ext.decode(resp.responseText);
                                if (data && data.error) {
                                    errorMsg = data.error;
                                }
                            } catch (e) {
                                errorMsg = 'Код ошибки: ' + resp.status;
                            }
                            Ext.Msg.alert(l('Ошибка'), errorMsg);
                        }
                    });
                }
            },
            this,
            false,
            ''
        );
    },

    onToggleEdit: function () {
        if (this.module) {
            if (this.module.state.editMode) {
                this.module.disableEditMode();
            } else {
                this.module.enableEditMode();
            }
        }
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
        var html = me.renderMemo(route, 'forward');
        me.down('#memoContent').update(html);
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
            var html = this.renderMemo(this.currentRoute, direction);
            this.down('#memoContent').update(html);
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
        if (this.chart) {
            this.chart.destroy();
        }
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
