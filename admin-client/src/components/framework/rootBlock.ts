/**
 * Root application block for the admin client.
 * Creates navbar, main content area with page containers.
 */
import { NONE, TMX_ADMIN, TMX_SYSTEM, TMX_SANCTIONING, TMX_DRAWER } from 'constants/tmxConstants';

const flexColFlexGrow = 'flexcol flexgrow';

export function rootBlock(): HTMLElement {
  const app = document.getElementById('app')!;
  app.appendChild(createNavbar());

  const main = document.getElementById('navMain')!;

  // System page container (superadmin)
  const system = document.createElement('div');
  system.className = flexColFlexGrow;
  system.style.display = NONE;
  system.id = TMX_SYSTEM;
  main.appendChild(system);

  // Admin page container
  const admin = document.createElement('div');
  admin.className = flexColFlexGrow;
  admin.style.display = NONE;
  admin.id = TMX_ADMIN;
  main.appendChild(admin);

  // Sanctioning page container
  const sanctioning = document.createElement('div');
  sanctioning.className = flexColFlexGrow;
  sanctioning.style.display = NONE;
  sanctioning.id = TMX_SANCTIONING;
  main.appendChild(sanctioning);

  // Drawer
  const drawer = document.createElement('section');
  drawer.className = 'drawer drawer--left';
  drawer.dataset.drawerTarget = '';
  drawer.id = TMX_DRAWER;
  drawer.innerHTML = `
    <div class="drawer__overlay" data-drawer-close tabIndex="-1"></div>
    <div class="drawer__wrapper">
      <div class="drawer__header">
        <div class="drawer__title"></div>
        <button class="drawer__close" style="display: none;" data-drawer-close aria-label="Close Drawer"></button>
      </div>
      <div class="drawer__content"></div>
      <div class="drawer__footer"></div>
    </div>
  `;
  app.appendChild(drawer);

  return app;
}

function createNavbar(): HTMLDivElement {
  const block = document.createElement('div');
  block.innerHTML = `<div id='dnav'>
    <div class="navbar-item" style="display: flex; flex-wrap: nowrap">
      <div id="provider" style="display: flex; flex-direction: column">
        <div style="font-size: .6em">CF Admin</div>
      </div>
      <div style="padding-left: 1em" id="pageTitle"> </div>
    </div>
    <div id='homenav' class="navbar-item" style="display: flex; flex-direction: row;">
      <i id='h-system' class="home-nav-icon fa-solid fa-server" title="System"></i>
      <i id='h-admin' class="home-nav-icon fa-solid fa-shield-halved" title="Admin"></i>
      <i id='h-sanctioning' class="home-nav-icon fa-solid fa-stamp" title="Sanctioning"></i>
    </div>
    <div class="navbar-item" style="font-size: 1em; display: flex; align-items: center; gap: 2px;">
      <i id="themeToggle" style="cursor: pointer; padding: 0 .4em; opacity: 0.7;" class="fa-solid fa-moon" title="Toggle theme"></i>
      <i id="login" style="padding-left: .5em" class="fa-solid fa-circle-user"></i>
    </div>
  </div>
  <main id="navMain"></main>`;

  return block;
}
