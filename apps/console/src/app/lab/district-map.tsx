"use client";

// District operations map (M8): voter dots in standard political
// cartography colors (data semantics, distinct from brand rules), plus
// yard-sign and event layers, with click-to-add placement.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createClient } from "@/lib/supabase/client";

export interface VoterPoint {
  lat: number;
  lng: number;
  party: string | null;
}
export interface SignPoint {
  lat: number;
  lng: number;
  address: string | null;
  placed_at: string;
}
export interface EventPoint {
  lat: number;
  lng: number;
  kind: string;
  title: string;
  held_at: string;
}

// Standard US political map colors — the one place red/blue is correct.
const PARTY_STYLES: { key: string; label: string; color: string }[] = [
  { key: "republican", label: "Republicans", color: "#E9141D" },
  { key: "democrat", label: "Democrats", color: "#0015BC" },
  { key: "independent", label: "Independents", color: "#EAB308" },
  { key: "other", label: "Other / unknown", color: "#16A34A" },
];

function partyKey(raw: string | null): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (["rep", "republican", "r", "gop"].includes(v)) return "republican";
  if (["dem", "democrat", "democratic", "d"].includes(v)) return "democrat";
  if (["ind", "independent", "i", "npp", "npa", "unaffiliated"].includes(v)) return "independent";
  return "other";
}

const EVENT_KINDS = ["house_meeting", "forum", "rally", "canvass_launch", "other"] as const;

type AddMode = "none" | "sign" | "event";

export function DistrictMap({
  campaignId,
  voters,
  signs,
  events,
}: {
  campaignId: string;
  voters: VoterPoint[];
  signs: SignPoint[];
  events: EventPoint[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [partyOn, setPartyOn] = useState<Record<string, boolean>>({
    republican: true,
    democrat: true,
    independent: true,
    other: true,
  });
  const [showSigns, setShowSigns] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [addMode, setAddMode] = useState<AddMode>("none");
  const addModeRef = useRef<AddMode>("none");
  const [pending, setPending] = useState<{ lat: number; lng: number } | null>(null);
  const [eventTitle, setEventTitle] = useState("");
  const [eventKind, setEventKind] = useState<string>("house_meeting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voterGeojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: voters.map((v) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [v.lng, v.lat] },
        properties: { party: partyKey(v.party) },
      })),
    }),
    [voters],
  );
  const signGeojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: signs.map((s) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
        properties: { label: s.address ?? "Yard sign" },
      })),
    }),
    [signs],
  );
  const eventGeojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: events.map((e) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [e.lng, e.lat] },
        properties: { label: `${e.title} (${e.kind.replace(/_/g, " ")})` },
      })),
    }),
    [events],
  );

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const first = voters[0] ?? signs[0] ?? events[0];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: first ? [first.lng, first.lat] : [-111.83, 33.41],
      zoom: first ? 12 : 10,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("voters", { type: "geojson", data: voterGeojson });
      map.addSource("signs", { type: "geojson", data: signGeojson });
      map.addSource("events", { type: "geojson", data: eventGeojson });

      map.addLayer({
        id: "voters-dots",
        type: "circle",
        source: "voters",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 15, 6],
          "circle-color": [
            "match",
            ["get", "party"],
            "republican", "#E9141D",
            "democrat", "#0015BC",
            "independent", "#EAB308",
            "#16A34A",
          ],
          "circle-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "signs-dots",
        type: "circle",
        source: "signs",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 15, 9],
          "circle-color": "#C8973A",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#FFFFFF",
        },
      });
      map.addLayer({
        id: "events-dots",
        type: "circle",
        source: "events",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 15, 12],
          "circle-color": "#0F2A4A",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#C8973A",
        },
      });

      for (const layer of ["signs-dots", "events-dots"] as const) {
        map.on("click", layer, (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          new maplibregl.Popup({ closeButton: false })
            .setLngLat(e.lngLat)
            .setText(String(feature.properties?.label ?? ""))
            .addTo(map);
        });
      }

      map.on("click", (e) => {
        if (addModeRef.current === "none") return;
        setPending({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      setReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    addModeRef.current = addMode;
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = addMode === "none" ? "" : "crosshair";
    }
  }, [addMode]);

  // Toggle visibility + party filter.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const activeParties = PARTY_STYLES.filter((p) => partyOn[p.key]).map((p) => p.key);
    map.setFilter("voters-dots", [
      "in",
      ["get", "party"],
      ["literal", activeParties],
    ]);
    map.setLayoutProperty("signs-dots", "visibility", showSigns ? "visible" : "none");
    map.setLayoutProperty("events-dots", "visibility", showEvents ? "visible" : "none");
  }, [partyOn, showSigns, showEvents, ready]);

  async function savePending() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const point = `POINT(${pending.lng} ${pending.lat})`;
    try {
      if (addMode === "sign") {
        const { error } = await supabase.from("yard_signs").insert({
          campaign_id: campaignId,
          location: point,
          placed_by: user?.id ?? null,
        });
        if (error) throw new Error(error.message);
      } else if (addMode === "event") {
        if (!eventTitle.trim()) throw new Error("Event needs a title.");
        const { error } = await supabase.from("campaign_events").insert({
          campaign_id: campaignId,
          kind: eventKind,
          title: eventTitle.trim(),
          location: point,
          held_at: new Date().toISOString(),
          created_by: user?.id ?? null,
        });
        if (error) throw new Error(error.message);
      }
      setPending(null);
      setAddMode("none");
      setEventTitle("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { republican: 0, democrat: 0, independent: 0, other: 0 };
    for (const v of voters) c[partyKey(v.party)]++;
    return c;
  }, [voters]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="relative h-[32rem] flex-1 overflow-hidden rounded-xl border border-rule">
        <div ref={containerRef} className="h-full w-full" />
        {voters.length === 0 && signs.length === 0 && events.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <p className="max-w-sm text-center text-sm text-slate">
              No mapped voters yet — voters appear here once the file is geocoded
              (or coordinates are imported).
            </p>
          </div>
        )}
      </div>

      <div className="w-full space-y-4 lg:w-64">
        <div>
          <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
            Voters by registration
          </p>
          {PARTY_STYLES.map((p) => (
            <label key={p.key} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink">
              <input
                type="checkbox"
                checked={partyOn[p.key]}
                onChange={() => setPartyOn((prev) => ({ ...prev, [p.key]: !prev[p.key] }))}
              />
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
              {p.label} <span className="ml-auto font-mono text-xs text-slate">{counts[p.key]}</span>
            </label>
          ))}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
            Campaign layers
          </p>
          <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink">
            <input type="checkbox" checked={showSigns} onChange={() => setShowSigns((s) => !s)} />
            <span className="inline-block h-3 w-3 rounded-full border-2 border-white bg-[#C8973A] outline outline-1 outline-rule" />
            Yard signs <span className="ml-auto font-mono text-xs text-slate">{signs.length}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink">
            <input type="checkbox" checked={showEvents} onChange={() => setShowEvents((s) => !s)} />
            <span className="inline-block h-3 w-3 rounded-full border-2 border-[#C8973A] bg-navy" />
            Events <span className="ml-auto font-mono text-xs text-slate">{events.length}</span>
          </label>
        </div>

        <div className="border-t border-rule pt-3">
          <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
            Add to map
          </p>
          {addMode === "none" ? (
            <div className="flex gap-2">
              <button
                onClick={() => setAddMode("sign")}
                className="rounded-lg border border-rule bg-white px-3 py-1.5 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
              >
                + Sign
              </button>
              <button
                onClick={() => setAddMode("event")}
                className="rounded-lg border border-rule bg-white px-3 py-1.5 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
              >
                + Event
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate">
                Click the map to place the {addMode === "sign" ? "sign" : "event"}.
              </p>
              {addMode === "event" && (
                <>
                  <input
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    placeholder="Event title"
                    className="w-full rounded-lg border border-rule bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-gold"
                  />
                  <select
                    value={eventKind}
                    onChange={(e) => setEventKind(e.target.value)}
                    className="w-full rounded-lg border border-rule bg-white px-2 py-1.5 text-sm text-ink"
                  >
                    {EVENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {pending && (
                <p className="font-mono text-xs text-slate">
                  {pending.lat.toFixed(5)}, {pending.lng.toFixed(5)}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => void savePending()}
                  disabled={busy || !pending || (addMode === "event" && !eventTitle.trim())}
                  className="rounded-lg bg-navy px-3 py-1.5 text-sm text-white transition-colors duration-200 ease-out hover:bg-navy-light disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setAddMode("none");
                    setPending(null);
                    setError(null);
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm text-slate hover:text-navy"
                >
                  Cancel
                </button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
