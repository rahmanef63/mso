/** Public barrel for the icon-picker slice.
 *
 *  Deliberately narrow: the catalogs (~600 emoji, ~250 lucide, ~190 phosphor
 *  components) are reachable only through the lazy picker body, so importing
 *  `<DynamicIcon>` or `<IconPickerPopover>` does not drag them into a caller's
 *  eager chunk. Render `<DynamicIcon value>` anywhere, `<IconPickerPopover>`
 *  to let users pick. Values are `emoji:<char> | lucide:<Name> | phosphor:<Name>`
 *  with an optional `?c=<hex>` tint. */

export { DynamicIcon, RawIcon, DEFAULT_ICON_SIZE } from "./components/DynamicIcon";
export { IconPickerPopover, IconPickerInline } from "./components/IconPicker";
export { PickerSkeleton } from "./components/PickerSkeleton";

export {
  parseIconValue,
  isLucideValue,
  isPhosphorValue,
  lucideValue,
  phosphorValue,
  withColor,
  LUCIDE_PREFIX,
  PHOSPHOR_PREFIX,
  type IconValue,
} from "./lib/parse";
