#!/usr/bin/env python3

import sys
import math
import urllib
import http.client as httplib
import time
import random

# id = '10092002'
id = 'nicolas'
# server = '192.168.0.250:31007'
server = '192.168.0.194:5055'
period = 5
step = 0.09
device_speed = 40
driver_id = '123456'

# waypoints = [
#     (48.853780, 2.344347),
#     (48.855235, 2.345852),
#     (48.857238, 2.347153),
#     (48.858509, 2.342563),
#     (48.856066, 2.340432),
#     (48.854780, 2.342230)
# ]

# waypoints = [
#     (43.479516,-1.518921),
#     (43.479755,-1.518038),
#     (43.479927,-1.517028),
#     (43.479794,-1.516492),
#     (43.479498,-1.516545),
#     (43.479218,-1.517211),
#     (43.478712,-1.517114),
#     (43.478455,-1.517512),
#     (43.478689,-1.517995),
#     (43.478782,-1.518682),
#     (43.478564,-1.519637),
#     (43.478658,-1.520346),
#     (43.479171,-1.520421),
#     (43.479421,-1.519282)
# ]

waypoints = [
    (43.479874,-1.517287),
    (43.481058,-1.512133),
    (43.481518,-1.513009),
    (43.481805,-1.513379),
    (43.482521,-1.515569),
    (43.483300,-1.516857),
    (43.484234,-1.519777),
    (43.483113,-1.520333),
    (43.480030,-1.52110),
    (43.480123,-1.522696),
    (43.478099,-1.522696)
]





points = []

for i in range(0, len(waypoints)):
    (lat1, lon1) = waypoints[i]
    (lat2, lon2) = waypoints[(i + 1) % len(waypoints)]
    length = math.sqrt((lat2 - lat1) ** 2 + (lon2 - lon1) ** 2)
    count = int(math.ceil(length / step))
    for j in range(0, count):
        lat = lat1 + (lat2 - lat1) * j / count
        lon = lon1 + (lon2 - lon1) * j / count
        points.append((lat, lon))

def send(conn, lat, lon, altitude, course, speed, battery, alarm, ignition, accuracy, rpm, fuel, driverUniqueId):
    params = (('id', id), ('timestamp', int(time.time())), ('lat', lat), ('lon', lon), ('altitude', altitude), ('bearing', course), ('speed', speed), ('batt', battery))
    conn.request('GET', '?' + urllib.parse.urlencode(params))
    conn.getresponse().read()

def course(lat1, lon1, lat2, lon2):
    lat1 = lat1 * math.pi / 180
    lon1 = lon1 * math.pi / 180
    lat2 = lat2 * math.pi / 180
    lon2 = lon2 * math.pi / 180
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return (math.atan2(y, x) % (2 * math.pi)) * 180 / math.pi

index = 0

conn = httplib.HTTPConnection(server)

while True:
    (lat1, lon1) = points[index % len(points)]
    (lat2, lon2) = points[(index + 1) % len(points)]
    altitude = 50
    speed = device_speed if (index % len(points)) != 0 else 0
    alarm = (index % 10) == 0
    battery = random.randint(0, 100)
    ignition = (index / 10 % 2) != 0
    accuracy = 100 if (index % 10) == 0 else 0
    rpm = random.randint(500, 4000)
    fuel = random.randint(0, 80)
    driverUniqueId = driver_id if (index % len(points)) == 0 else False
    send(conn, lat1, lon1, altitude, course(lat1, lon1, lat2, lon2), speed, battery, alarm, ignition, accuracy, rpm, fuel, driverUniqueId)
    time.sleep(period)
    index += 1