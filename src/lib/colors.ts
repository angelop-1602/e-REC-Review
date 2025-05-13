// Brand Colors
export const COLORS = {
  // Green
  brand: {
    green: {
      DEFAULT: '#036635',
      light: '#047a40',
      dark: '#025128',
      50: '#e6f7ef',
      100: '#ccefdf',
      200: '#99dfbf',
      300: '#66cf9f',
      400: '#33bf7f',
      500: '#00af5f',
      600: '#039350',
      700: '#036635',
      800: '#024d28',
      900: '#01341a',
    },
    yellow: {
      DEFAULT: '#FECC07',
      light: '#fed339',
      dark: '#e3b700',
      50: '#fff9e6',
      100: '#fff3cc',
      200: '#ffe799',
      300: '#ffdc66',
      400: '#fed033',
      500: '#FECC07',
      600: '#e3b700',
      700: '#b08e00',
      800: '#7d6500',
      900: '#4a3c00',
    },
  }
};

// Common styles that can be used as inline styles
export const STYLES = {
  brandGreenButton: {
    backgroundColor: COLORS.brand.green.DEFAULT,
    color: 'white',
  },
  brandGreenHover: {
    backgroundColor: COLORS.brand.green.light,
  },
  brandGreenText: {
    color: COLORS.brand.green.DEFAULT,
  },
  brandGreenBackground: {
    backgroundColor: COLORS.brand.green[50],
  },
  brandGreenBorder: {
    borderColor: COLORS.brand.green.DEFAULT,
  },
  // Yellow styles
  brandYellowButton: {
    backgroundColor: COLORS.brand.yellow.DEFAULT,
    color: 'white',
  },
  brandYellowHover: {
    backgroundColor: COLORS.brand.yellow.light,
  },
  brandYellowText: {
    color: COLORS.brand.yellow.DEFAULT,
  },
  brandYellowBackground: {
    backgroundColor: COLORS.brand.yellow[50],
  },
  brandYellowBorder: {
    borderColor: COLORS.brand.yellow.DEFAULT,
  },
}; 