export function airportHalfFare(priceCents: number) {
  return Math.round(priceCents / 2);
}

export function airportReservationTotal(priceCents: number, seatCount: number, halfFareCount: number) {
  return priceCents * (seatCount - halfFareCount) + airportHalfFare(priceCents) * halfFareCount;
}
