Scout Fundraiser

## GitHub Pages

This app is now configured to deploy as a static site on GitHub Pages.

### Included in this repo

- GitHub Pages workflow: `.github/workflows/deploy-pages.yml`
- SPA-safe static asset paths and service worker registration
- Manifest configured for subpath hosting
- Receipt sharing fallback that avoids server-only email APIs on GitHub Pages

### Required GitHub setup

1. Push to the `main` branch.
2. In GitHub, open `Settings > Pages`.
3. Set `Source` to `GitHub Actions`.

### Required Firebase setup

GitHub Pages hosting works only if the deployed site domain is authorized in Firebase Authentication.

Add these domains in Firebase Console:

1. `Authentication > Settings > Authorized domains`
2. Add your GitHub Pages domain, for example:
	`your-user.github.io`
3. If this is a project site, also add:
	`your-user.github.io/your-repo` is not entered directly here; only the host `your-user.github.io` is needed.

### Notes

- The app is client-side only on GitHub Pages. Any server endpoint like `/api/send-receipt` will not exist there, so receipt email sharing falls back to a `mailto:` link.
- The app uses hash-based navigation, which is compatible with GitHub Pages static hosting.
