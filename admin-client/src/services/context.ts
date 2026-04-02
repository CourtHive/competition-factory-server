import type { ProviderValue } from 'types/tmx';

export const context: {
  tables: any;
  ee: any;
  drawer: any;
  modal: any;
  state: {
    authorized: boolean;
    admin: boolean;
  };
  router?: { navigate: (path: string) => void; resolve: () => void; current: any[] | null };
  provider?: ProviderValue;
} = {
  tables: [],
  ee: null,
  drawer: null,
  modal: null,
  state: {
    authorized: false,
    admin: false,
  },
};
