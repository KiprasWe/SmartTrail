// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

export type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  // — Existing —
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',

  // — Navigation & UI —
  'chevron.left': 'chevron-left',
  'xmark': 'close',
  'xmark.circle.fill': 'cancel',
  'arrow.left': 'arrow-back',
  'arrow.right': 'arrow-forward',
  'arrow.clockwise': 'refresh',
  'plus': 'add',
  'checkmark': 'check',

  // — Map & Location —
  'map': 'map',
  'mappin': 'place',
  'mappin.fill': 'place',
  'location.fill': 'my-location',
  'scope': 'my-location',

  // — Transport —
  'figure.walk': 'directions-walk',
  'figure.run': 'directions-run',
  'figure.hiking': 'hiking',
  'bicycle': 'directions-bike',
  'mountain.2.fill': 'terrain',
  'mountain.2': 'terrain',
  'bolt.fill': 'bolt',

  // — Terrain —
  'minus': 'remove',
  'waveform': 'show-chart',

  // — POI categories —
  'eye.fill': 'visibility',
  'fork.knife': 'restaurant',
  'building.columns.fill': 'account-balance',
  'building.2.fill': 'history',
  'leaf.fill': 'park',
  'bag.fill': 'shopping-bag',

  // — POI details —
  'star.fill': 'star',
  'cup.and.saucer.fill': 'local-cafe',
  'wineglass.fill': 'local-bar',
  'clock.fill': 'timer',
  'lightbulb.fill': 'lightbulb',
  'link': 'link',
  'book.fill': 'menu-book',

  // — AI —
  'wand.and.sparkles': 'auto-awesome',

  // — Security —
  'lock.fill': 'lock',

  // — Profile & Social —
  'person.fill': 'person',
  'person.2.fill': 'group',
  'person.badge.plus': 'person-add',
  'camera.fill': 'camera-alt',
};

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name] as ComponentProps<typeof MaterialIcons>['name']} style={style} />;
}
