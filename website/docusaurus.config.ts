import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Cryozen Agent',
  tagline: 'The self-improving AI agent',
  favicon: 'img/favicon.ico',

  // Published as a GitHub Pages project site: the landing page and install
  // scripts live at https://cryozenai.github.io/cryozen-agent/ and the docs
  // under /cryozen-agent/docs/ (see .github/workflows/deploy-site.yml).
  url: 'https://cryozenai.github.io',
  baseUrl: '/cryozen-agent/docs/',

  organizationName: 'cryozenai',
  projectName: 'cryozen-agent',

  onBrokenLinks: 'warn',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  themes: [
    '@docusaurus/theme-mermaid',
  ],

  plugins: [
    // Static /plugins/<name> and /plugins/by/<author> pages generated from the catalog JSON.
    './plugins/plugin-catalog-pages',
    [
      '@docusaurus/plugin-client-redirects',
      {
        // Static-host redirects for renamed doc pages (GitHub Pages can't
        // do server-side redirects). Paths are relative to baseUrl.
        redirects: [
          {
            // Renamed in #44470 (Automation Blueprints terminology rebrand)
            from: '/guides/automation-templates',
            to: '/guides/automation-blueprints',
          },
          {
            // Moved when the Plugins subcategory was created under
            // Developer Guide > Extending (docs restructure, July 2026)
            from: '/guides/build-a-cryozen-plugin',
            to: '/developer-guide/plugins',
          },
          {
            // Users guess these short paths from abbreviated links and hit
            // raw 404s (consumer-onboarding audit finding #1, Aug 2026).
            from: '/quickstart',
            to: '/getting-started/quickstart',
          },
          {
            from: '/installation',
            to: '/getting-started/installation',
          },
        ],
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',  // Docs at the root of baseUrl
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/cryozenai/cryozen-agent/edit/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/cryozen-agent-banner.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    navbar: {
      title: 'Cryozen Agent',
      logo: {
        alt: 'Cryozen Agent',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/skills',
          label: 'Skills',
          position: 'left',
        },
        {
          to: '/plugins',
          label: 'Plugins',
          position: 'left',
        },
        {
          to: '/getting-started/installation',
          label: 'Install',
          position: 'left',
        },
        {
          href: 'https://github.com/cryozenai/cryozen-agent',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/getting-started/quickstart' },
            { label: 'User Guide', to: '/user-guide/cli' },
            { label: 'Developer Guide', to: '/developer-guide/architecture' },
            { label: 'Reference', to: '/reference/cli-commands' },
          ],
        },
        {
          title: 'Support',
          items: [
            { label: 'Discussions', href: 'https://github.com/cryozenai/cryozen-agent/discussions' },
            { label: 'GitHub Issues', href: 'https://github.com/cryozenai/cryozen-agent/issues' },
            { label: 'Skills Hub', href: 'https://agentskills.io' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'Desktop App', to: '/user-guide/desktop' },
            { label: 'GitHub', href: 'https://github.com/cryozenai/cryozen-agent' },
            { label: 'Cryozen', href: 'https://github.com/cryozenai' },
          ],
        },
      ],
      copyright: `Built by <a href="https://github.com/cryozenai">Cryozen</a> · MIT License · ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'yaml', 'json', 'python', 'toml'],
    },
    mermaid: {
      theme: {light: 'neutral', dark: 'dark'},
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
