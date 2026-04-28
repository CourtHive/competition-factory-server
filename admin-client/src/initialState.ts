import { initLoginToggle, getLoginState } from 'services/authentication/loginState';
import { initTheme, initThemeToggle } from 'services/theme/themeService';
import { version, buildCommit, buildTime } from 'config/version';
import { loadRuntimeConfig } from 'services/runtimeConfig';
import { routeAdmin } from 'router/router';

import 'courthive-components/dist/courthive-components.css';
import 'tabulator-tables/dist/css/tabulator_simple.css';
import 'animate.css/animate.min.css';
import 'styles/theme.css';
import 'styles/forms.css';
import 'styles/admin.css';

export function setupAdmin(): void {
  // Boot banner — mirrors TMX. Lets us verify "is the running build the
  // one I just rebuilt?" by reading the console.
  const logStyle = 'color: lightblue';
  console.log(`%cadmin-client: ${version}`, logStyle);
  console.log(`%cbuild: ${buildCommit} (${buildTime})`, logStyle);

  initTheme();
  initThemeToggle('themeToggle');
  initLoginToggle('login');
  getLoginState();
  // Fire-and-forget — the impersonate handler awaits the same promise if a
  // user clicks before this resolves, so there's no race.
  void loadRuntimeConfig();
  routeAdmin();
}
