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
        // ========================================================================
        // НОВОЕ: Храним координаты последнего клика для модального окна остановки
        // ========================================================================
        pendingStopCoords: null,
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

        // СОЗДАЕМ ДЕРЕВО МАРШРУТОВ И СОХРАНЯЕМ ССЫЛКУ
        me.routeTree = Ext.create('Store.passenger_transit.view.RouteTree', {
            module: me
        });

        // ========================================================================
        // СОЗДАЕМ ГРИД ТС МАРШРУТА (НИЖНЯЯ ЧАСТЬ ЛЕВОЙ ПАНЕЛИ)
        // ========================================================================
        me.vehiclesGrid = Ext.create('Store.passenger_transit.view.RouteVehiclesGrid', {
            module: me
        });

        // ========================================================================
        // КОНТЕЙНЕР ДЛЯ РАЗДЕЛЕНИЯ ПАНЕЛИ НА 2 ЧАСТИ (ВЕРХ / НИЗ)
        // ========================================================================
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

        // Карта PILOT остается видимой
        me.navTab.map_frame = null;

        // Integrate with PILOT skeleton
        if (window.skeleton && skeleton.navigation && skeleton.mapframe) {
            skeleton.navigation.add(me.navTab);

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
                if (data.success) me.loadRoutes();
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
                    Ext.toast({ html: l('Остановка добавлена'), align: 't', timeout: 2000 });
                    me.selectRoute(routeId);
                } else {
                    Ext.Msg.alert(l('Ошибка'), data.error || l('Не удалось добавить остановку'));
                }
            },
            failure: function () {
                Ext.Msg.alert(l('Ошибка'), l('Ошибка соединения с бэкендом'));
            }
        });
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

    // ==================== ОБНОВЛЕНИЕ ГРИДА ТС МАРШРУТА ====================

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

    // ========================================================================
    // НОВОЕ: МОДАЛЬНОЕ ОКНО ДОБАВЛЕНИЯ ОСТАНОВКИ (аналогично вкладке Рейсы PILOT)
    // ========================================================================

    /**
     * Открывает модальное окно добавления остановки с предзаполненными координатами.
     * @param {Object} coords - {lat, lon} координаты клика по карте
     */
    showAddStopWindow: function(coords) {
        var me = this;

        if (!me.state.selectedRoute) {
            Ext.Msg.alert(l('Внимание'), l('Сначала выберите маршрут'));
            return;
        }

        // Создаем временный маркер для предпросмотра
        me._previewStopMarker = L.circleMarker([coords.lat, coords.lon], {
            radius: 10,
            fillColor: '#f59e0b',
            color: '#fff',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.8,
            dashArray: '4, 4'
        }).addTo(me.getPilotMap().map);

        // Создаем модальное окно
        me.addStopWindow = Ext.create('Store.passenger_transit.view.AddStopWindow', {
            module: me,
            coords: coords,
            listeners: {
                save: function(win, stopData) {
                    me.addStop(me.state.selectedRoute, stopData);
                    me.removePreviewStopMarker();
                },
                cancel: function() {
                    me.removePreviewStopMarker();
                },
                beforeclose: function() {
                    me.removePreviewStopMarker();
                }
            }
        });

        me.addStopWindow.show();
    },

    removePreviewStopMarker: function() {
        var me = this;
        if (me._previewStopMarker) {
            var map = me.getPilotMap();
            if (map && map.map) {
                map.map.removeLayer(me._previewStopMarker);
            }
            me._previewStopMarker = null;
        }
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
            var icon = L.divIcon({
                className: 'pt-stop-marker',
                html: '<div class="pt-stop-number">' + (index + 1) + '</div>',
                iconSize: [28, 28], iconAnchor: [14, 14]
            });
            var marker = L.marker([stop.lat, stop.lon], { icon: icon, title: stop.name }).addTo(map.map);
            marker.bindPopup('<b>' + Ext.String.htmlEncode(stop.name) + '</b><br/>' + l('Остановка') + ' #' + (index + 1));
            marker.on('click', function () {
                if (me.state.selectedRoute && me.memoPanel) me.memoPanel.highlightStop(index);
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
                html: '<div class="pt-vehicle-icon"><i class="fa fa-bus"></i></div>' +
                      '<div class="pt-vehicle-number">' + Ext.String.htmlEncode(veh.number || '') + '</div>',
                iconSize: [40, 40], iconAnchor: [20, 20]
            });
            var marker = L.marker([veh.lat, veh.lon], { icon: icon, title: veh.number }).addTo(map.map);
            marker.on('click', function () { me.selectVehicle(veh.id, routeId); });
            if (!me.state.mapLayers.vehicles[routeId]) me.state.mapLayers.vehicles[routeId] = [];
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
        if (route.stops && route.stops.length > 0) me.drawStops(routeId, route.stops);

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

        if (me.memoPanel) me.memoPanel.loadRoute(route);
        if (me.timelinePanel) me.timelinePanel.renderChart(me.getTimeline(routeId));

        me.updateRouteVehiclesGrid(routeId);
    },

    selectVehicle: function (vehicleId, routeId) {
        var me = this;
        me.state.selectedVehicle = vehicleId;
        var trackInfo = me.getVehicleTrack(vehicleId, routeId);
        me.drawVehicleTrack(vehicleId, trackInfo.track);
        Ext.Msg.alert(
            l('ТС') + ' ' + vehicleId,
            l('Выполнено рейсов') + ': <b>' + (trackInfo.trips_count || 0) + '</b>'
        );
    },

    // ========================================================================
    // ИЗМЕНЕНО: Режим добавления остановок теперь открывает МОДАЛЬНОЕ ОКНО
    // ========================================================================
    enableEditMode: function () {
        var me = this;
        if (me.state.routeEditMode) {
            Ext.Msg.alert(l('Внимание'), l('Сначала завершите редактирование маршрута'));
            return;
        }
        if (!me.state.selectedRoute) {
            Ext.Msg.alert(l('Внимание'), l('Сначала выберите маршрут'));
            return;
        }
        me.state.editMode = true;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        me._mapClickHandler = function (e) {
            if (!me.state.editMode || !me.state.selectedRoute) return;

            // Сохраняем координаты клика
            me.state.pendingStopCoords = {
                lat: parseFloat(e.latlng.lat.toFixed(6)),
                lon: parseFloat(e.latlng.lng.toFixed(6))
            };

            // ОТКРЫВАЕМ МОДАЛЬНОЕ ОКНО ДОБАВЛЕНИЯ ОСТАНОВКИ
            me.showAddStopWindow(me.state.pendingStopCoords);
        };
        map.map.on('click', me._mapClickHandler);
        Ext.toast({ html: l('Кликните по карте для добавления остановки'), align: 't', timeout: 5000 });
    },

    disableEditMode: function () {
        var me = this;
        me.state.editMode = false;
        var map = me.getPilotMap();
        if (map && map.map && me._mapClickHandler) map.map.off('click', me._mapClickHandler);
        me.removePreviewStopMarker();
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
        if (me.routeTree) me.routeTree.loadRoutes(me.state.routes);
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
            { text: l('Добавить'), iconCls: 'fa fa-plus', handler: me.onAddRoute, scope: me, tooltip: l('Создать новый маршрут') },
            { text: l('Остановки'), iconCls: 'fa fa-edit', handler: me.onToggleEdit, scope: me, itemId: 'editBtn', tooltip: l('Режим добавления остановок') },
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
            }, scope: me, tooltip: l('Привязать ТС к маршруту') }
        ];

        me.columns = [
            { xtype: 'treecolumn', text: l('Маршрут'), dataIndex: 'name', flex: 1 },
            { text: l('ТС'), dataIndex: 'vehicle_count', width: 45, align: 'center', tooltip: l('Количество привязанных ТС') },
            { text: l('Ост.'), dataIndex: 'stop_count', width: 45, align: 'center', tooltip: l('Количество остановок') }
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
                stop_count: r.stop_count || 0,
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
                                    align: 't', timeout: 3000
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
                                if (data && data.error) errorMsg = data.error;
                            } catch (e) {
                                errorMsg = 'Код ошибки: ' + resp.status;
                            }
                            Ext.Msg.alert(l('Ошибка'), errorMsg);
                        }
                    });
                }
            },
            this, false, ''
        );
    },

    onToggleEdit: function () {
        if (this.module) {
            if (this.module.state.editMode) this.module.disableEditMode();
            else this.module.enableEditMode();
        }
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
                text: l('Госномер'),
                dataIndex: 'vehicle_number',
                flex: 1.2,
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
                text: l('Направление'),
                dataIndex: 'direction',
                width: 70,
                align: 'center',
                sortable: true,
                renderer: function(value) {
                    if (value === 'forward') {
                        return '<div class="pt-direction-badge pt-direction-forward" title="' + l('Прямое направление') + '">' +
                               '<i class="fa fa-long-arrow-right"></i></div>';
                    } else if (value === 'backward') {
                        return '<div class="pt-direction-badge pt-direction-backward" title="' + l('Обратное направление') + '">' +
                               '<i class="fa fa-long-arrow-left"></i></div>';
                    }
                    return '<span style="color:#94a3b8">—</span>';
                }
            },
            {
                text: l('Рейсов'),
                dataIndex: 'trips_count',
                width: 65,
                align: 'center',
                sortable: true,
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
// НОВОЕ: VIEW: AddStopWindow - МОДАЛЬНОЕ ОКНО ДОБАВЛЕНИЯ ОСТАНОВКИ
// Аналогично вкладке "Рейсы" в PILOT
// ============================================================================
Ext.define('Store.passenger_transit.view.AddStopWindow', {
    extend: 'Ext.window.Window',
    alias: 'widget.pt-addstopwindow',
    cls: 'pt-addstop-window',
    modal: true,
    width: 460,
    closable: true,
    resizable: false,
    closeAction: 'destroy',
    title: '<i class="fa fa-map-marker"></i> ' + l('Добавить остановку'),

    initComponent: function () {
        var me = this;
        var coords = me.coords || { lat: 0, lon: 0 };

        me.items = [{
            xtype: 'form',
            itemId: 'stopForm',
            bodyPadding: 16,
            border: false,
            defaults: {
                labelWidth: 120,
                anchor: '100%',
                msgTarget: 'side'
            },
            items: [
                {
                    xtype: 'displayfield',
                    fieldLabel: l('Маршрут'),
                    cls: 'pt-addstop-route-name',
                    value: me.module && me.module.state.selectedRoute
                        ? (me.module.getRouteById(me.module.state.selectedRoute) || {}).name || '—'
                        : '—'
                },
                {
                    xtype: 'textfield',
                    name: 'name',
                    itemId: 'stopName',
                    fieldLabel: l('Название') + ':',
                    emptyText: l('Например: пл. Ленина'),
                    allowBlank: false,
                    minLength: 2,
                    maxLength: 100,
                    minLengthText: l('Минимум 2 символа'),
                    maxLengthText: l('Максимум 100 символов'),
                    listeners: {
                        afterrender: function(field) {
                            setTimeout(function() { field.focus(true, 100); }, 100);
                        },
                        specialkey: function(field, e) {
                            if (e.getKey() === e.ENTER) {
                                me.onSaveClick();
                            }
                        }
                    }
                },
                {
                    xtype: 'fieldcontainer',
                    fieldLabel: l('Координаты') + ':',
                    layout: 'hbox',
                    defaults: {
                        flex: 1,
                        labelWidth: 30,
                        decimalPrecision: 6,
                        minValue: -180,
                        maxValue: 180,
                        allowDecimals: true,
                        allowBlank: false
                    },
                    items: [
                        {
                            xtype: 'numberfield',
                            name: 'lat',
                            itemId: 'stopLat',
                            fieldLabel: l('Шир'),
                            value: coords.lat,
                            minValue: -90,
                            maxValue: 90
                        },
                        {
                            xtype: 'numberfield',
                            name: 'lon',
                            itemId: 'stopLon',
                            fieldLabel: l('Дол'),
                            value: coords.lon,
                            margin: '0 0 0 8'
                        }
                    ]
                },
                {
                    xtype: 'textarea',
                    name: 'description',
                    fieldLabel: l('Описание') + ':',
                    emptyText: l('Необязательное описание остановки'),
                    maxLength: 255,
                    height: 60,
                    grow: true,
                    growMin: 40,
                    growMax: 120
                },
                {
                    xtype: 'container',
                    cls: 'pt-addstop-hint',
                    html: '<i class="fa fa-info-circle"></i> ' +
                          l('Координаты взяты из клика по карте. Вы можете изменить их вручную.')
                }
            ]
        }];

        me.buttons = [
            {
                text: l('Сохранить'),
                iconCls: 'fa fa-check',
                cls: 'pt-btn-primary',
                formBind: true,
                handler: me.onSaveClick,
                scope: me
            },
            {
                text: l('Отмена'),
                iconCls: 'fa fa-times',
                handler: me.onCancelClick,
                scope: me
            }
        ];

        me.callParent(arguments);
    },

    onSaveClick: function () {
        var me = this;
        var form = me.down('#stopForm').getForm();

        if (!form.isValid()) {
            Ext.toast({
                html: l('Заполните все обязательные поля'),
                align: 't',
                timeout: 2500
            });
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

        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            Ext.Msg.alert(l('Ошибка'), l('Некорректные координаты'));
            return;
        }

        var stopData = {
            name: name,
            lat: lat,
            lon: lon
        };

        if (values.description && values.description.trim()) {
            stopData.description = values.description.trim();
        }

        me.fireEvent('save', me, stopData);
        me.close();
    },

    onCancelClick: function () {
        var me = this;
        me.fireEvent('cancel', me);
        me.close();
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
