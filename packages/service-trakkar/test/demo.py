#!/usr/bin/env python3

import os
import json
import math
import urllib
import http.client as httplib
import time
from threading import Thread

# Configuration globale
SERVER = 'localhost:5055'
PERIOD = 0.1  # Intervalle entre deux envois
STEP = 0.0009  # Distance minimale entre deux points simulés
TRAJECTORY_FOLDER = "trajectory"  # Dossier contenant les fichiers GeoJSON


class Device:
    def __init__(self, device_id, geojson_path, speed):
        self.device_id = device_id
        self.speed = speed
        self.waypoints = self.load_waypoints_from_geojson(geojson_path)
        self.points = self.interpolate_points(self.waypoints, STEP)
        self.conn = httplib.HTTPConnection(SERVER)
        self.index = 0
        self.total_points = len(self.points)  # Nombre total de points

    @staticmethod
    def load_waypoints_from_geojson(filepath):
        """Charge les waypoints depuis un fichier GeoJSON contenant un seul feature."""
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Le fichier {filepath} est introuvable.")
        
        with open(filepath, 'r') as file:
            data = json.load(file)
        
        if 'geometry' not in data or data['geometry'].get('type') != 'LineString':
            raise ValueError(f"Le fichier {filepath} doit contenir une géométrie LineString.")
        
        return data['geometry'].get('coordinates', [])

    @staticmethod
    def interpolate_points(waypoints, step):
        """Génère des points intermédiaires entre les waypoints."""
        points = []
        for i in range(len(waypoints) - 1):
            (lon1, lat1) = waypoints[i]
            (lon2, lat2) = waypoints[i + 1]
            length = math.sqrt((lat2 - lat1) ** 2 + (lon2 - lon1) ** 2)
            count = int(math.ceil(length / step))
            for j in range(count):
                lat = lat1 + (lat2 - lat1) * j / count
                lon = lon1 + (lon2 - lon1) * j / count
                points.append((lat, lon))
        # Ajouter le dernier point
        points.append((waypoints[-1][1], waypoints[-1][0]))
        return points

    @staticmethod
    def calculate_course(lat1, lon1, lat2, lon2):
        """Calcule la direction (bearing) entre deux points."""
        lat1 = math.radians(lat1)
        lon1 = math.radians(lon1)
        lat2 = math.radians(lat2)
        lon2 = math.radians(lon2)
        y = math.sin(lon2 - lon1) * math.cos(lat2)
        x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
        return (math.atan2(y, x) % (2 * math.pi)) * 180 / math.pi

    def calculate_battery_level(self):
        """Calcule la batterie restante en fonction de la progression."""
        return max(0, 100 - (self.index / (self.total_points - 1)) * 100)

    def send_data(self, lat, lon, course, speed, battery):
        """Envoie les données au serveur."""
        params = {
            'id': self.device_id,
            'timestamp': int(time.time()),
            'lat': lat,
            'lon': lon,
            'bearing': course,
            'speed': speed,
            'batt': round(battery, 2),  # Batterie arrondie à deux décimales
        }
        self.conn.request('GET', '?' + urllib.parse.urlencode(params))
        self.conn.getresponse().read()

    def simulate(self):
        """Simule les données de l'appareil."""
        while self.index < self.total_points:
            lat1, lon1 = self.points[self.index % len(self.points)]
            lat2, lon2 = self.points[(self.index + 1) % len(self.points)] if self.index + 1 < self.total_points else (lat1, lon1)
            course = self.calculate_course(lat1, lon1, lat2, lon2) if self.index + 1 < self.total_points else 0
            speed = self.speed if self.index + 1 < self.total_points else 0
            battery = self.calculate_battery_level()
            self.send_data(lat1, lon1, course, speed, battery)
            time.sleep(PERIOD)
            self.index += 1


# Fonction pour charger les appareils depuis le dossier trajectory
def load_devices_from_folder(folder, speed):
    devices = []
    if not os.path.exists(folder):
        raise FileNotFoundError(f"Le dossier {folder} est introuvable.")
    
    for filename in os.listdir(folder):
        if filename.endswith('.json'):
            device_id = os.path.splitext(filename)[0]  # Nom du fichier sans l'extension
            geojson_path = os.path.join(folder, filename)
            devices.append(Device(device_id, geojson_path, speed))
    return devices


# Charger les appareils
print("Chargement des appareils...")
DEVICES = load_devices_from_folder(TRAJECTORY_FOLDER, speed=40)

if not DEVICES:
    print("Aucun appareil trouvé dans le dossier.")
    exit()

# Lancer les threads pour chaque appareil
threads = []
for device in DEVICES:
    thread = Thread(target=device.simulate)
    threads.append(thread)
    thread.start()

# Attente des threads (si nécessaire)
for thread in threads:
    thread.join()
