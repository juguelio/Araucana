"use client";

export function ServiceCardVideo() {
  return <video className="service-card-video" autoPlay muted loop playsInline preload="metadata" onEnded={(event) => { event.currentTarget.currentTime = 0; void event.currentTarget.play(); }} aria-hidden="true"><source src="/video-aeropuerto.mp4" type="video/mp4" /></video>;
}
