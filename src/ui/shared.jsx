import React from "react";
import { Text } from "./components.jsx";
export function Empty({ children }) {
  return (
    <Text c="dimmed" ta="center" p="xl">
      {children}
    </Text>
  );
}
