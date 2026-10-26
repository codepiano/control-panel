import React, { useEffect, useState } from "react";
import { Modal as MantineModal } from "./components-modal.jsx";

// Mantine's focus-return hook records the trigger on a closed -> open update.
// Lazy surfaces may mount already open; establish the closed state first so
// Escape and the close button still return focus to the original trigger.
/** @param {import('@mantine/core').ModalProps} props */
export function Modal({ opened, ...props }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <MantineModal {...props} opened={mounted && opened} />;
}
