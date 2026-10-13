(function () {
    const STORAGE_KEY = 'theme-setting';
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function getSavedSetting() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'auto';
        } catch (e) {
            return 'auto';
        }
    }

    function resolveTheme(setting) {
        if (setting === 'auto') {
            return mediaQuery.matches ? 'dark' : 'light';
        }
        return setting;
    }

    function applyTheme(setting) {
        const activeTheme = resolveTheme(setting);
        document.documentElement.setAttribute('data-theme', activeTheme);
        document.documentElement.setAttribute('data-theme-setting', setting);
        updateButton(setting, activeTheme);
    }

    function updateButton(setting, activeTheme) {
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;

        btn.setAttribute('data-setting', setting);
        btn.setAttribute('data-active-theme', activeTheme);

        let label = '';
        if (setting === 'auto') {
            label = `Theme: Auto (${activeTheme}) — click for light`;
        } else if (setting === 'light') {
            label = 'Theme: Light — click for dark';
        } else {
            label = 'Theme: Dark — click for auto sync';
        }
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    }

    function cycleTheme() {
        const current = getSavedSetting();
        let next = 'auto';
        if (current === 'auto') {
            next = 'light';
        } else if (current === 'light') {
            next = 'dark';
        } else {
            next = 'auto';
        }

        try {
            if (next === 'auto') {
                localStorage.removeItem(STORAGE_KEY);
            } else {
                localStorage.setItem(STORAGE_KEY, next);
            }
        } catch (e) {}

        applyTheme(next);
    }

    // Auto-sync listener for system preferences
    if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', function () {
            if (getSavedSetting() === 'auto') {
                applyTheme('auto');
            }
        });
    } else if (mediaQuery.addListener) {
        mediaQuery.addListener(function () {
            if (getSavedSetting() === 'auto') {
                applyTheme('auto');
            }
        });
    }

    function init() {
        const btn = document.getElementById('theme-toggle');
        if (btn) {
            btn.addEventListener('click', cycleTheme);
            const setting = getSavedSetting();
            updateButton(setting, resolveTheme(setting));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
