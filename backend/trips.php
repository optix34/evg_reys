<?php
declare(strict_types=1);

// passenger_transit/backend/trips.php
// Бизнес-логика для работы с треками, рейсами и таймлайнами
// Strict compliance with AI_SPECS.md Rule 8.1 (PILOT Store Proxy URL Rules)

require_once __DIR__ . '/config.php';

/**
 * Получить данные трека транспортного средства
 * В production-версии здесь должен быть запрос к PILOT API:
 * /ax/rep.php?cmd=get_messages&object_id=...&from=...&to=...
 * 
 * @param string $vehicleId ID объекта в PILOT
 * @param string $fromDate Дата начала (Y-m-d H:i:s)
 * @param string $toDate Дата окончания (Y-m-d H:i:s)
 * @param int|null $routeId ID маршрута (опционально, для генерации демо-трека по точкам)
 * @return array Массив точек трека
 */
function getVehicleTrackData(string $vehicleId, string $fromDate, string $toDate, ?int $routeId = null): array {
    // Если передан routeId, генерируем реалистичный демо-трек на основе точек маршрута
    if ($routeId !== null) {
        $db = getDb();
        $routePoints = $db->query("
            SELECT lat, lon FROM route_points 
            WHERE route_id = $routeId AND direction = 'forward'
            ORDER BY order_index ASC
        ")->fetchAll();

        if (empty($routePoints)) {
            return [];
        }

        $track = [];
        $baseTime = strtotime($fromDate);
        if ($baseTime === false) {
            $baseTime = strtotime(date('Y-m-d') . ' 06:00:00');
        }

        foreach ($routePoints as $i => $p) {
            // Добавляем небольшой случайный сдвиг для реалистичности (имитация отклонения от идеальной линии)
            $latOffset = (rand(-30, 30) / 100000);
            $lonOffset = (rand(-30, 30) / 100000);
            
            // Имитация скорости (20-60 км/ч)
            $speed = rand(20, 60);
            
            // Имитация направления (курс в градусах)
            $dir = ($i * 15 + rand(0, 10)) % 360;

            $track[] = [
                'lat' => (float)$p['lat'] + $latOffset,
                'lon' => (float)$p['lon'] + $lonOffset,
                'time' => date('Y-m-d H:i:s', $baseTime + ($i * 300)), // Каждые 5 минут
                'speed' => $speed,
                'dir' => $dir,
                'order' => $i
            ];
        }

        return $track;
    }

    // Если routeId не передан, возвращаем пустой массив (в production - запрос к PILOT API)
    return [];
}

/**
 * Получить данные таймлайна распределения рейсов по часам
 * 
 * @param int $routeId ID маршрута
 * @param string $date Дата (Y-m-d)
 * @return array Данные таймлайна (часы и количество рейсов)
 */
function getRouteTimelineData(int $routeId, string $date): array {
    // В production здесь должен быть анализ реальных треков ТС, привязанных к маршруту
    // Для MVP генерируем реалистичные демо-данные с учетом часов пик
    
    $hours = [];
    $trips = [];
    
    // Рабочее время пассажирских перевозок: с 05:00 до 23:00
    for ($h = 5; $h <= 23; $h++) {
        $hours[] = sprintf('%02d:00', $h);
        
        // Имитация часов пик (утро: 7-9, вечер: 17-19)
        if (in_array($h, [7, 8, 9])) {
            $trips[] = rand(6, 12); // Утренний пик
        } elseif (in_array($h, [17, 18, 19])) {
            $trips[] = rand(5, 10); // Вечерний пик
        } elseif ($h >= 10 && $h <= 16) {
            $trips[] = rand(2, 5);  // Дневное время
        } else {
            $trips[] = rand(0, 2);  // Раннее утро и поздний вечер
        }
    }
    
    return [
        'hours' => $hours,
        'trips' => $trips,
        'total_trips' => array_sum($trips),
        'peak_hours' => ['07:00-09:00', '17:00-19:00'],
        'date' => $date
    ];
}

/**
 * Подсчитать количество рейсов, выполненных ТС за дату
 * В production - анализ данных из /ax/rep.php?cmd=get_trips
 * 
 * @param string $vehicleId ID объекта в PILOT
 * @param string $date Дата (Y-m-d)
 * @return array Статистика по рейсам
 */
function getVehicleTripCount(string $vehicleId, string $date): array {
    // Демо-данные: случайное количество рейсов от 3 до 10
    $tripsCount = rand(3, 10);
    $avgDuration = rand(45, 90); // Средняя длительность рейса в минутах
    $totalDistance = $tripsCount * rand(12, 18); // Общий пробег в км
    
    return [
        'vehicle_id' => $vehicleId,
        'date' => $date,
        'trips_count' => $tripsCount,
        'average_trip_duration_min' => $avgDuration,
        'total_distance_km' => $totalDistance,
        'first_trip_start' => $date . ' 06:15:00',
        'last_trip_end' => $date . ' 20:45:00'
    ];
}

/**
 * Рассчитать расстояние между двумя точками по формуле Haversine
 * Полезно для подсчета общего пробега по треку
 * 
 * @param float $lat1 Широта точки 1
 * @param float $lon1 Долгота точки 1
 * @param float $lat2 Широта точки 2
 * @param float $lon2 Долгота точки 2
 * @return float Расстояние в километрах
 */
function calculateDistanceBetweenPoints(float $lat1, float $lon1, float $lat2, float $lon2): float {
    $earthRadius = 6371; // Радиус Земли в км
    
    $dLat = deg2rad($lat2 - $lat1);
    $dLon = deg2rad($lon2 - $lon1);
    
    $a = sin($dLat / 2) * sin($dLat / 2) +
         cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
         sin($dLon / 2) * sin($dLon / 2);
         
    $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
    
    return $earthRadius * $c;
}

/**
 * Рассчитать общую статистику по треку (дистанция, время, средняя скорость)
 * 
 * @param array $track Массив точек трека
 * @return array Статистика
 */
function calculateTrackStatistics(array $track): array {
    if (count($track) < 2) {
        return [
            'total_distance_km' => 0,
            'duration_minutes' => 0,
            'average_speed_kmh' => 0,
            'max_speed_kmh' => 0
        ];
    }
    
    $totalDistance = 0;
    $maxSpeed = 0;
    $speeds = [];
    
    for ($i = 1; $i < count($track); $i++) {
        $dist = calculateDistanceBetweenPoints(
            $track[$i - 1]['lat'], $track[$i - 1]['lon'],
            $track[$i]['lat'], $track[$i]['lon']
        );
        $totalDistance += $dist;
        
        $speed = (float)($track[$i]['speed'] ?? 0);
        $speeds[] = $speed;
        if ($speed > $maxSpeed) {
            $maxSpeed = $speed;
        }
    }
    
    $avgSpeed = !empty($speeds) ? array_sum($speeds) / count($speeds) : 0;
    
    // Расчет времени (если есть временные метки)
    $durationMinutes = 0;
    if (isset($track[0]['time']) && isset($track[count($track) - 1]['time'])) {
        $startTime = strtotime($track[0]['time']);
        $endTime = strtotime($track[count($track) - 1]['time']);
        if ($startTime && $endTime) {
            $durationMinutes = round(($endTime - $startTime) / 60);
        }
    }
    
    return [
        'total_distance_km' => round($totalDistance, 2),
        'duration_minutes' => $durationMinutes,
        'average_speed_kmh' => round($avgSpeed, 1),
        'max_speed_kmh' => $maxSpeed,
        'points_count' => count($track)
    ];
}
