"use client";

import { createContext, type ReactNode } from "react";
import type { Sentido } from "./ida-y-vuelta/trip-search-bar";

export type PrivateAirportLeg = {
  direction: Sentido;
  date: string;
  flight: { id: string; number: string; scheduledAt: string; estimatedAt: string | null } | null;
  clearFlight: () => void;
};

/** El alta administrativa aporta los campos privados al mismo buscador que usa el traslado compartido. */
export const PrivateAirportContext = createContext<{
  place: string;
  renderForm: (search: ReactNode, legs: PrivateAirportLeg[], flightError: string) => ReactNode;
} | null>(null);

export const PrivateAirportChoiceContext = createContext<ReactNode>(null);
