import { initLoginToggle, getLoginState } from 'services/authentication/loginState';
import { initTheme, initThemeToggle } from 'services/theme/themeService';
import { routeAdmin } from 'router/router';

import 'courthive-components/dist/courthive-components.css';
import 'tabulator-tables/dist/css/tabulator_simple.css';
import 'animate.css/animate.min.css';
import 'styles/theme.css';
import 'styles/forms.css';
import 'styles/admin.css';

export function setupAdmin(): void {
  initTheme();
  initThemeToggle('themeToggle');
  initLoginToggle('login');
  getLoginState();
  routeAdmin();
}
