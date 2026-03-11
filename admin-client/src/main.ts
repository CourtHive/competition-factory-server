/**
 * Competition Factory Admin — entry point.
 *
 * This is the admin/superuser interface for managing providers, users,
 * and server configuration. Served from the competition-factory-server.
 */

const app = document.getElementById('app');
if (app) {
  app.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px;">
      <h1>Competition Factory Admin</h1>
      <p>Admin and superuser interface — under construction.</p>
      <p>This application will provide:</p>
      <ul>
        <li><strong>Provider Management</strong> — create, edit, and manage providers (organisations)</li>
        <li><strong>User Management</strong> — invite users, assign roles, manage permissions</li>
        <li><strong>Provider Configuration</strong> — white labeling, feature governance, policy defaults</li>
      </ul>
    </div>
  `;
}
