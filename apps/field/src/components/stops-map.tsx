// Walk-list map: MapLibre GL JS inside a WebView (Expo Go-compatible, free
// OSM raster tiles per ADR — no Google Maps SDK). Shows pins for stops that
// have coordinates; voters without geocoded locations simply have no pin.
// Swap for native @maplibre/maplibre-react-native when we move to dev builds.

import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "@/lib/theme";

export interface MapPin {
  lat: number;
  lng: number;
  label: string;
  visited: boolean;
}

export function StopsMap({ pins }: { pins: MapPin[] }) {
  const html = useMemo(() => buildHtml(pins), [pins]);

  if (pins.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>
          No mapped doors on this list — voters in this file don&apos;t have coordinates yet.
          Stops are ordered street-by-street in the list view.
        </Text>
      </View>
    );
  }

  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html }}
      style={styles.map}
      // The map is display-only; no need for JS bridges back into the app.
      javaScriptEnabled
      domStorageEnabled={false}
    />
  );
}

function buildHtml(pins: MapPin[]): string {
  const center = pins[0];
  const pinsJson = JSON.stringify(pins);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<style>html,body,#map{margin:0;height:100%;background:#0b0b0d}</style>
</head>
<body>
<div id="map"></div>
<script>
  const pins = ${pinsJson};
  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors"
        }
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }]
    },
    center: [${center.lng}, ${center.lat}],
    zoom: 14
  });
  const bounds = new maplibregl.LngLatBounds();
  for (const p of pins) {
    const el = document.createElement("div");
    el.style.cssText = "width:26px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;font:600 12px sans-serif;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);background:" + (p.visited ? "#34d399" : "#2563eb");
    el.textContent = p.label;
    new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    bounds.extend([p.lng, p.lat]);
  }
  if (pins.length > 1) map.fitBounds(bounds, { padding: 48 });
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: colors.bg },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: colors.dim, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
