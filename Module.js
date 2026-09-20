// passenger_transit/Module.js
// PILOT Extension: Пассажирские перевозки
// Pattern C (Existing Map) + Pattern A (Full UI)
// Strict compliance with AI_SPECS.md

Ext.define('Store.passenger_transit.Module', {
    extend: 'Ext.Component',
    extensionName: 'passenger_transit',

    state: {
        routes: [],
        selectedRoute: null,
        selectedVehicle: null,
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

        // Загрузка из localStorage
        me.loadFromLocalStorage();

        // === ЛЕВАЯ ПАНЕЛЬ: 2 секции (маршруты сверху, ТС снизу) ===
        var leftPanel = Ext.create('Ext.panel.Panel', {
            layout: 'border',
            items: [
                // Верхняя секция: дерево маршрутов
                Ext.create('Store.passenger_transit.view.RouteTree', {
                    region: 'center',
                    module: me,
                    title: l('Маршруты'),
                    collapsible: false
                }),
                // Нижняя секция: список ТС
                Ext.create('Store.passenger_transit.view.VehicleList', {
                    region: 'south',
                    module: me,
                    title: l('Транспортные средства'),
                    height: 220,
                    split: true,
                    collapsible: true
                })
            ]
        });

        var navTab = Ext.create('Pilot.utils.LeftBarPanel', {
            title: l('Рейсы'),
            iconCls: 'fa fa-bus',
            iconAlign: 'top',
            minimized: false,
            width: 400,
            items: [leftPanel]
        });

        // === ОСНОВНАЯ ПАНЕЛЬ (мнемосхема + таймлайн) ===
        var mainPanel = Ext.create('Store.passenger_transit.view.MainPanel', {
            module: me
        });

        // Обязательная связь (AI_SPECS Rule 3)
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
                    handler: function () {
                        skeleton.navigation.setActiveTab(navTab);
                    },
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

    // ==================== КАРТА PILOT (Pattern C) ====================

    getPilotMap: function () {
        // Используем существующую карту PILOT
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
            params: {
                vehs: 1,
                state: 1,
                lat: 1,
                lon: 1,
                dir: 1,
                speed: 1
            },
            success: function (resp) {
                try {
                    var groups = Ext.decode(resp.responseText);
                    me.state.pilotVehicles = me.parsePilotTree(groups);
                    Ext.log('passenger_transit: Загружено ТС:', me.state.pilotVehicles.length);

                    // Обновляем список ТС в левой панели
                    me.refreshVehicleList();

                    // Если выбран маршрут, обновляем маркеры на карте
                    if (me.state.selectedRoute) {
                        me.drawVehicles(me.state.selectedRoute, me.getRouteVehicles());
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

    // ==================== МОДАЛЬНОЕ ОКНО СОЗДАНИЯ МАРШРУТА ====================

    showCreateRouteWindow: function () {
        var me = this;

        var win = Ext.create('Ext.window.Window', {
            title: l('Создание маршрута'),
            width: 700,
            height: 600,
            layout: 'fit',
            modal: true,
            closeAction: 'destroy',
            items: [{
                xtype: 'form',
                bodyPadding: 15,
                scrollable: true,
                defaults: {
                    labelWidth: 150,
                    anchor: '100%'
                },
                items: [
                    {
                        xtype: 'textfield',
                        name: 'route_number',
                        fieldLabel: l('Номер маршрута') + ' *',
                        allowBlank: false,
                        emptyText: l('Например: 42')
                    },
                    {
                        xtype: 'textfield',
                        name: 'route_name',
                        fieldLabel: l('Наименование') + ' *',
                        allowBlank: false,
                        emptyText: l('Например: Центр - Вокзал')
                    },
                    {
                        xtype: 'fieldset',
                        title: l('Остановки прямого направления'),
                        collapsible: true,
                        collapsed: false,
                        items: [{
                            xtype: 'grid',
                            itemId: 'forwardStopsGrid',
                            height: 150,
                            store: Ext.create('Ext.data.Store', {
                                fields: ['name', 'lat', 'lon'],
                                data: []
                            }),
                            columns: [
                                { text: l('Остановка'), dataIndex: 'name', flex: 1 },
                                { text: 'Lat', dataIndex: 'lat', width: 100 },
                                { text: 'Lon', dataIndex: 'lon', width: 100 }
                            ],
                            tbar: [{
                                text: l('Добавить с карты'),
                                iconCls: 'fa fa-map-marker-alt',
                                handler: function () {
                                    me.enableStopPickMode('forward', win);
                                }
                            }, {
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
                    },
                    {
                        xtype: 'fieldset',
                        title: l('Остановки обратного направления'),
                        collapsible: true,
                        collapsed: false,
                        items: [{
                            xtype: 'grid',
                            itemId: 'backwardStopsGrid',
                            height: 150,
                            store: Ext.create('Ext.data.Store', {
                                fields: ['name', 'lat', 'lon'],
                                data: []
                            }),
                            columns: [
                                { text: l('Остановка'), dataIndex: 'name', flex: 1 },
                                { text: 'Lat', dataIndex: 'lat', width: 100 },
                                { text: 'Lon', dataIndex: 'lon', width: 100 }
                            ],
                            tbar: [{
                                text: l('Добавить с карты'),
                                iconCls: 'fa fa-map-marker-alt',
                                handler: function () {
                                    me.enableStopPickMode('backward', win);
                                }
                            }, {
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
                ]
            }],
            buttons: [
                {
                    text: l('Сохранить'),
                    iconCls: 'fa fa-save',
                    formBind: true,
                    handler: function () {
                        var form = win.down('form');
                        if (!form.isValid()) return;

                        var values = form.getValues();
                        var forwardStore = win.down('#forwardStopsGrid').getStore();
                        var backwardStore = win.down('#backwardStopsGrid').getStore();

                        var newId = me.state.routes.length > 0
                            ? Math.max.apply(null, me.state.routes.map(function (r) { return r.id; })) + 1
                            : 1;

                        me.state.routes.push({
                            id: newId,
                            number: values.route_number,
                            name: values.route_name,
                            vehicle_count: 0,
                            stops: forwardStore.getRange().map(function (r) {
                                return { id: Date.now() + Math.random(), name: r.get('name'), lat: r.get('lat'), lon: r.get('lon'), order_index: r.index };
                            }),
                            forward_points: forwardStore.getRange().map(function (r, i) {
                                return { lat: r.get('lat'), lon: r.get('lon'), order_index: i };
                            }),
                            backward_points: backwardStore.getRange().map(function (r, i) {
                                return { lat: r.get('lat'), lon: r.get('lon'), order_index: i };
                            })
                        });

                        me.saveToLocalStorage();
                        me.refreshRouteTree();
                        me.selectRoute(newId);
                        win.close();
                        Ext.toast({ html: l('Маршрут создан'), align: 't', timeout: 2000 });
                    }
                },
                {
                    text: l('Отмена'),
                    handler: function () {
                        win.close();
                    }
                }
            ]
        });

        win.show();
    },

    // Режим выбора остановки с карты
    enableStopPickMode: function (direction, win) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) {
            Ext.Msg.alert(l('Ошибка'), l('Карта PILOT недоступна'));
            return;
        }

        Ext.toast({
            html: l('Кликните по карте для добавления остановки направления: ') + (direction === 'forward' ? l('Прямое') : l('Обратное')),
            align: 't',
            timeout: 5000
        });

        var handler = function (e) {
            map.map.off('click', handler);

            Ext.Msg.prompt(l('Название остановки'), l('Введите название:'), function (btn, text) {
                if (btn === 'ok' && text) {
                    var grid = win.down('#' + direction + 'StopsGrid');
                    var store = grid.getStore();
                    store.add({
                        name: text,
                        lat: e.latlng.lat,
                        lon: e.latlng.lng
                    });
                }
            });
        };

        map.map.on('click', handler);
    },

    // ==================== CRUD ОПЕРАЦИИ ====================

    createRoute: function (number, name) {
        var me = this;
        var newId = me.state.routes.length > 0
            ? Math.max.apply(null, me.state.routes.map(function (r) { return r.id; })) + 1
            : 1;

        me.state.routes.push({
            id: newId,
            number: number || String(newId),
            name: name,
            vehicle_count: 0,
            stops: [],
            forward_points: [],
            backward_points: []
        });

        me.saveToLocalStorage();
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
            me.saveToLocalStorage();
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
            me.saveToLocalStorage();
            me.selectRoute(routeId);
            Ext.toast({ html: l('Маршрут сохранен'), align: 't', timeout: 2000 });
        }
    },

    // ==================== ОТОБРАЖЕНИЕ НА КАРТЕ PILOT ====================

    drawRoute: function (routeId, forwardPoints, backwardPoints) {
        var map = this.getPilotMap();
        if (!map || !map.map) {
            Ext.toast({ html: l('Карта PILOT недоступна. Перейдите в раздел Online или History.'), align: 't' });
            return;
        }

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

    drawStops: function (routeId, stops) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;

        this.clearStops(routeId);
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
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });

            var marker = L.marker([veh.lat, veh.lon], { icon: icon, title: veh.number }).addTo(map.map);
            marker.on('click', function () {
                me.selectVehicle(veh.id, routeId);
            });

            if (!me.state.mapLayers.vehicles[routeId]) me.state.mapLayers.vehicles[routeId] = [];
            me.state.mapLayers.vehicles[routeId].push(marker);
        });
    },

    drawVehicleTrack: function (vehicleId, routeId) {
        var map = this.getPilotMap();
        if (!map || !map.map) return;

        this.clearTrack(vehicleId);
        var route = this.getRouteById(routeId);
        if (!route || !route.forward_points) return;

        var points = route.forward_points.map(function (p) { return [p.lat, p.lon]; });
        if (points.length > 1) {
            var line = L.polyline(points, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map.map);
            this.state.mapLayers.tracks[vehicleId + '_forward'] = line;
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
        var key = vehicleId + '_forward';
        if (this.state.mapLayers.tracks[key]) {
            map.map.removeLayer(this.state.mapLayers.tracks[key]);
            delete this.state.mapLayers.tracks[key];
        }
    },

    // ==================== РЕДАКТИРОВАНИЕ МАРШРУТА ====================

    enableRouteEditMode: function (routeId, direction) {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) {
            Ext.Msg.alert(l('Ошибка'), l('Карта PILOT недоступна. Убедитесь, что вы находитесь в разделе Online или History.'));
            return;
        }

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

        map.map.on('click', me._routeEditClickHandler);
        map.map.on('contextmenu', me._routeEditRightClickHandler);
        me.showRouteEditToolbar();

        Ext.toast({ html: l('Кликайте по карте для добавления точек. Правый клик - завершить.'), align: 't', timeout: 5000 });
    },

    drawEditingPolyline: function () {
        var me = this;
        var map = me.getPilotMap();
        if (!map || !map.map) return;

        if (me.state.mapLayers.editingPolyline) map.map.removeLayer(me.state.mapLayers.editingPolyline);
        if (me.state.mapLayers.editingPoints) {
            me.state.mapLayers.editingPoints.forEach(function (m) { map.map.removeLayer(m); });
            me.state.mapLayers.editingPoints = [];
        }

        var dir = me.state.editDirection;
        var points = me.state.editingRoutePoints[dir];
        if (points.length === 0) return;

        var latlngs = points.map(function (p) { return [p.lat, p.lon]; });
        var color = dir === 'forward' ? '#2563eb' : '#dc2626';
        var polyline = L.polyline(latlngs, { color: color, weight: 5, opacity: 0.9, dashArray: dir === 'backward' ? '8, 6' : null }).addTo(map.map);
        me.state.mapLayers.editingPolyline = polyline;

        points.forEach(function (p, index) {
            var marker = L.circleMarker([p.lat, p.lon], { radius: 6, fillColor: color, color: '#fff', weight: 2 }).addTo(map.map);
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
                    { text: l('Удалить посл.'), iconCls: 'fa fa-undo', handler: function () { me.state.editingRoutePoints[me.state.editDirection].pop(); me.drawEditingPolyline(); me.updateEditToolbarStats(); }, scope: me },
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

    // ==================== РЕДАКТИРОВАНИЕ ОСТАНОВОК ====================

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

        me.state.editMode = true;
        me._mapClickHandler = function (e) {
            if (!me.state.editMode || !me.state.selectedRoute) return;
            Ext.Msg.prompt(l('Новая остановка'), l('Название:'), function (btn, text) {
                if (btn === 'ok' && text) {
                    me.addStop(me.state.selectedRoute, { name: text, lat: e.latlng.lat, lon: e.latlng.lng });
                }
            }, this, false, '');
        };
        map.map.on('click', me._mapClickHandler);
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

    // ==================== ВЫБОР МАРШРУТА И ТС ====================

    selectRoute: function (routeId) {
        var me = this;
        me.state.selectedRoute = routeId;
        var route = me.getRouteById(routeId);
        if (!route) return;

        me.drawRoute(routeId, route.forward_points, route.backward_points);
        if (route.stops && route.stops.length > 0) me.drawStops(routeId, route.stops);
        me.drawVehicles(routeId, me.getRouteVehicles());

        var mainPanel = me.getMainPanel();
        if (mainPanel && mainPanel.memoPanel) mainPanel.memoPanel.loadRoute(route);
        if (mainPanel && mainPanel.timelinePanel) mainPanel.timelinePanel.renderChart(me.getTimeline());
    },

    selectVehicle: function (vehicleId, routeId) {
        var me = this;
        me.state.selectedVehicle = vehicleId;
        me.drawVehicleTrack(vehicleId, routeId);

        var vehicle = me.state.pilotVehicles.find(function (v) { return v.id === vehicleId; });
        var tripsCount = Math.floor(Math.random() * 5) + 3;
        Ext.Msg.alert(
            l('ТС'),
            (vehicle ? vehicle.number : vehicleId) + '<br/>' + l('Выполнено рейсов') + ': <b>' + tripsCount + '</b>'
        );
    },

    getRouteVehicles: function () {
        return this.state.pilotVehicles.filter(function (v) { return v.online; });
    },

    getTimeline: function () {
        var hours = [], trips = [];
        for (var h = 6; h <= 22; h++) {
            hours.push(h + ':00');
            trips.push(h >= 7 && h <= 9 || h >= 17 && h <= 19 ? Math.floor(Math.random() * 5) + 3 : Math.floor(Math.random() * 2));
        }
        return { hours: hours, trips: trips };
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

    refreshRouteTree: function () {
        var leftPanel = this.getMainPanel();
        // Находим дерево маршрутов в левой панели
        var navTab = skeleton.navigation.items && skeleton.navigation.items.getAt ? skeleton.navigation.items.getAt(skeleton.navigation.items.length - 1) : null;
        if (navTab && navTab.items) {
            var leftPanel = navTab.items.getAt(0);
            if (leftPanel && leftPanel.items) {
                var routeTree = leftPanel.items.getAt(0);
                if (routeTree && routeTree.loadRoutes) {
                    routeTree.loadRoutes(this.state.routes);
                }
            }
        }
    },

    refreshVehicleList: function () {
        var navTab = skeleton.navigation.items && skeleton.navigation.items.getAt ? skeleton.navigation.items.getAt(skeleton.navigation.items.length - 1) : null;
        if (navTab && navTab.items) {
            var leftPanel = navTab.items.getAt(0);
            if (leftPanel && leftPanel.items) {
                var vehicleList = leftPanel.items.getAt(1);
                if (vehicleList && vehicleList.loadVehicles) {
                    vehicleList.loadVehicles(this.state.pilotVehicles);
                }
            }
        }
    }
});

// ==================== VIEW: RouteTree (Без колонки ТС) ====================
Ext.define('Store.passenger_transit.view.RouteTree', {
    extend: 'Ext.tree.Panel',
    rootVisible: false,
    useArrows: true,
    cls: 'pt-route-tree',

    initComponent: function () {
        var me = this;
        me.store = Ext.create('Ext.data.TreeStore', { root: { expanded: true, children: [] } });

        me.tbar = [
            {
                text: l('Добавить'),
                iconCls: 'fa fa-plus',
                handler: function () {
                    if (me.module) me.module.showCreateRouteWindow();
                },
                scope: me
            },
            {
                text: l('Остановки'),
                iconCls: 'fa fa-edit',
                handler: me.onToggleEdit,
                scope: me
            },
            {
                text: l('Рисовать'),
                iconCls: 'fa fa-pencil',
                handler: function () {
                    var rec = me.getSelectionModel().getSelection()[0];
                    if (rec && me.module) me.module.enableRouteEditMode(rec.data.route_id, 'forward');
                    else Ext.Msg.alert(l('Внимание'), l('Выберите маршрут'));
                },
                scope: me
            }
        ];

        // УБРАНА колонка ТС
        me.columns = [
            { xtype: 'treecolumn', text: l('Маршрут'), dataIndex: 'name', flex: 1 }
        ];

        me.listeners = { itemclick: me.onRouteClick, scope: me };
        me.callParent(arguments);
    },

    loadRoutes: function (routes) {
        var me = this;
        var children = routes.map(function (r) {
            return {
                text: (r.number ? '#' + r.number + ' - ' : '') + r.name,
                name: (r.number ? '#' + r.number + ' - ' : '') + r.name,
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

    onToggleEdit: function () {
        if (this.module) {
            if (this.module.state.editMode) this.module.disableEditMode();
            else this.module.enableEditMode();
        }
    }
});

// ==================== VIEW: VehicleList (Новая секция снизу) ====================
Ext.define('Store.passenger_transit.view.VehicleList', {
    extend: 'Ext.grid.Panel',
    cls: 'pt-vehicle-list',

    initComponent: function () {
        var me = this;

        me.store = Ext.create('Ext.data.Store', {
            fields: ['id', 'number', 'group', 'online', 'speed', 'lat', 'lon'],
            data: []
        });

        me.columns = [
            {
                text: l('ТС'),
                dataIndex: 'number',
                flex: 1,
                renderer: function (value, meta, record) {
                    var online = record.get('online');
                    meta.tdAttr = 'style="background-color:' + (online ? '#dcfce7' : '#fee2e2') + '"';
                    return value + (online ? ' <span style="color:green">●</span>' : ' <span style="color:red">●</span>');
                }
            },
            {
                text: l('Группа'),
                dataIndex: 'group',
                width: 120
            },
            {
                text: l('Скорость'),
                dataIndex: 'speed',
                width: 70,
                align: 'center'
            }
        ];

        me.listeners = {
            itemclick: function (view, record) {
                if (me.module && me.module.state.selectedRoute) {
                    me.module.selectVehicle(record.get('id'), me.module.state.selectedRoute);
                }
            },
            scope: me
        };

        me.callParent(arguments);
    },

    loadVehicles: function (vehicles) {
        this.getStore().loadData(vehicles);
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
                xtype: 'panel',
                cls: 'pt-map-placeholder',
                html: '<div class="pt-map-hint">' + l('Используйте карту PILOT для отображения маршрутов. Выберите маршрут слева.') + '</div>'
            },
            Ext.create('Store.passenger_transit.view.RouteMemoPanel', {
                region: 'east',
                module: me.module,
                width: 300,
                split: true,
                collapsible: true,
                title: l('Мнемосхема'),
                listeners: { afterrender: function () { me.memoPanel = this; } }
            }),
            Ext.create('Store.passenger_transit.view.TimelinePanel', {
                region: 'south',
                module: me.module,
                height: 180,
                split: true,
                title: l('График рейсов'),
                listeners: { afterrender: function () { me.timelinePanel = this; } }
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
            html += '<div class="pt-memo-stop-number">' + num + '</div><div class="pt-memo-stop-name">' + Ext.String.htmlEncode(stop.name) + '</div></div>';
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
