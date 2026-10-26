import { Button, Select, createTheme } from "./components.jsx";
export const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "md",
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  headings: { fontFamily: "inherit" },
  components: {
    Button: Button.extend({ defaultProps: { size: "sm" } }),
    Select: Select.extend({
      defaultProps: {
        allowDeselect: false,
        checkIconPosition: "right",
        comboboxProps: { withinPortal: true },
      },
    }),
    Modal: {
      defaultProps: {
        centered: true,
        overlayProps: { backgroundOpacity: 0.35, blur: 3 },
      },
    },
  },
});
