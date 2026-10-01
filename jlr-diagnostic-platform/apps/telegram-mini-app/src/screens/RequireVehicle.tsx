import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Empty, Screen } from "../components/ui";
import { useSession } from "../state/session";

export function RequireVehicle({ children }: { children: (vehicleId: string) => ReactNode }) {
  const { activeVehicleId } = useSession();
  if (!activeVehicleId) {
    return (
      <Screen title="No vehicle selected">
        <Empty
          action={
            <Link className="btn btn-primary" to="/">
              Go to Dashboard
            </Link>
          }
        >
          Connect to a vehicle or pick one from the Vehicles list first.
        </Empty>
      </Screen>
    );
  }
  return <>{children(activeVehicleId)}</>;
}
