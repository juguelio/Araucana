export type SubmitDeparturePassengerState = {
  status: "idle" | "ok" | "error";
  message: string;
  passengerName?: string;
  updated?: boolean;
};

export const initialSubmitState: SubmitDeparturePassengerState = { status: "idle", message: "" };
