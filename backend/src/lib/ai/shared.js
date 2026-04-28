// lib/ai/shared.js — shared constants, helpers, and Gemini client.
//
// Anything used by more than one ai/* module lives here. Anything used by only
// one module stays in that module.

import { GoogleGenAI } from "@google/genai";

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
export const ORS_API_KEY = process.env.ORS_API_KEY;

export const ORS_WAYPOINT_CAP = 20;

export const genai = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

export const LANG_INSTRUCTIONS = {
  lt: "Respond in Lithuanian. Use Lithuanian place names where they exist.",
  en: "Respond in English.",
};

export const PROFILE_FALLBACK_THEME = {
  Walking: "scenic viewpoints, hidden gems, and local landmarks",
  Hiking: "natural landmarks, sweeping viewpoints, and forest trails",
  Running: "parks, riverside paths, and green spaces",
  Cycling: "parks, panoramic viewpoints, and cultural landmarks",
  "Mountain Biking": "forests, technical trails, and natural viewpoints",
  "Road Cycling": "scenic roads, coffee stops, and cultural highlights",
  "E-Bike": "parks, scenic routes, and cultural landmarks",
};

export function sanitizePromptInput(raw, maxLen = 400) {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function extractJsonArray(text) {
  if (!text) return null;
  let t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("[");
    const e = t.lastIndexOf("]");
    if (s !== -1 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function dedupPois(pois) {
  const seen = new Set();
  return pois.filter((poi) => {
    if (!poi) return false;
    if (poi.place_id) {
      if (seen.has(poi.place_id)) return false;
      seen.add(poi.place_id);
      return true;
    }
    if (
      typeof poi.lat === "number" &&
      typeof poi.lng === "number" &&
      isFinite(poi.lat) &&
      isFinite(poi.lng)
    ) {
      const key = `${poi.lat.toFixed(5)},${poi.lng.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    console.warn("[aiRouting] Dropping POI with missing coords:", poi.name);
    return false;
  });
}
