const assert = require('node:assert');
const { getRequestedPage, getRedirectPage, getLoginPageWithError } = require('../build/lib/utils');

const LOGIN_PAGE = '/login/index.html';

/**
 * Builds the body the login form posts: it sends its own URL back in `origin`
 *
 * @param target page the user asked for, as the middleware encodes it into the login link
 * @param suffix what the server appended to the login URL, e.g. the error flag
 */
function form(target, suffix) {
    return { body: { origin: `${LOGIN_PAGE}?href=${encodeURIComponent(target)}${suffix || ''}` } };
}

describe('Login redirect', function () {
    describe('keeps the page the user asked for', function () {
        it('a plain path', function () {
            assert.strictEqual(getRedirectPage(form('/cometvisu/')), '/cometvisu/');
        });

        it('a query parameter without a value', function () {
            assert.strictEqual(getRedirectPage(form('/cometvisu/?config')), '/cometvisu/?config');
        });

        // the regression: "=" was missing from the old character whitelist, which the target was
        // checked against after it had been decoded
        it('a query parameter with a value', function () {
            assert.strictEqual(getRedirectPage(form('/cometvisu/?config=demo')), '/cometvisu/?config=demo');
        });

        it('several query parameters', function () {
            const target = '/cometvisu/?config=p8a&enableCache=false';
            assert.strictEqual(getRedirectPage(form(target)), target);
        });

        it('a query string and a fragment', function () {
            const target = '/vis-2/index.html?project=main#view_1';
            assert.strictEqual(getRedirectPage(form(target)), target);
        });

        // the browser copies the fragment of the originally requested URL onto a redirect target
        // that has none, so the login page appends it to the origin field itself
        it('a fragment the browser carried over to the login page', function () {
            assert.strictEqual(
                getRedirectPage(form('/cometvisu/?config=demo', '#id_10_')),
                '/cometvisu/?config=demo#id_10_',
            );
        });

        it('a target next to the error flag', function () {
            assert.strictEqual(getRedirectPage(form('/cometvisu/?config=demo', '&error')), '/cometvisu/?config=demo');
        });

        it('a target behind the error flag', function () {
            const origin = `${LOGIN_PAGE}?error&href=${encodeURIComponent('/cometvisu/?config=demo')}`;
            assert.strictEqual(getRedirectPage({ body: { origin } }), '/cometvisu/?config=demo');
        });

        it('an encoded character inside the target', function () {
            assert.strictEqual(getRedirectPage(form('/vis/Haus & Garten.html')), '/vis/Haus & Garten.html');
        });
    });

    describe('refuses everything that is not a path on this server', function () {
        const refused = {
            'another origin': 'https://evil.com/',
            'a protocol relative URL': '//evil.com/',
            'a backslash, which the browser reads as a slash': '/\\evil.com/',
            'a relative target': 'evil.html',
            'a bare fragment': '#anchor',
            // browsers remove tab and newline before they parse a URL, so these would turn into
            // the protocol relative "//evil.com"
            'a smuggled tab': '/\t/evil.com',
            'a smuggled newline': '/\r\n/evil.com',
            'a smuggled delete character': '/\x7f/evil.com',
        };

        Object.keys(refused).forEach(name => {
            it(name, function () {
                assert.strictEqual(getRedirectPage(form(refused[name])), '../');
                assert.strictEqual(getRequestedPage(form(refused[name])), null);
            });
        });

        it('an empty target', function () {
            assert.strictEqual(getRedirectPage(form('')), '../');
        });

        it('a login URL without a query string', function () {
            assert.strictEqual(getRedirectPage({ body: { origin: LOGIN_PAGE } }), '../');
        });

        it('a login URL with another parameter only', function () {
            assert.strictEqual(getRedirectPage({ body: { origin: `${LOGIN_PAGE}?error` } }), '../');
        });

        it('an empty origin', function () {
            assert.strictEqual(getRedirectPage({ body: { origin: '' } }), '../');
        });

        it('no body at all', function () {
            assert.strictEqual(getRedirectPage({}), '../');
        });
    });

    // an already authenticated user opening a login link is sent on directly, without a form post
    describe('reads the target of an authenticated request from the query string', function () {
        it('a query string and a fragment', function () {
            const href = '/cometvisu/?config=p8a&enableCache=false';
            assert.strictEqual(getRedirectPage({ query: { href } }), href);
        });

        it('refuses another origin here as well', function () {
            assert.strictEqual(getRedirectPage({ query: { href: '//evil.com/' } }), '../');
        });

        it('refuses a repeated parameter, which express hands over as an array', function () {
            assert.strictEqual(getRedirectPage({ query: { href: ['/a', '/b'] } }), '../');
        });

        it('falls back to the root without a parameter', function () {
            assert.strictEqual(getRedirectPage({ query: {} }), '../');
        });

        it('lets the posted form win over the query string', function () {
            assert.strictEqual(getRedirectPage({ ...form('/a'), query: { href: '/b' } }), '/a');
        });
    });

    describe('reports a failed attempt without losing the target', function () {
        it('carries the target along fully encoded', function () {
            assert.strictEqual(
                getLoginPageWithError(LOGIN_PAGE, form('/cometvisu/?config=demo')),
                `${LOGIN_PAGE}?href=%2Fcometvisu%2F%3Fconfig%3Ddemo&error`,
            );
        });

        it('falls back to the root when there is no target', function () {
            assert.strictEqual(getLoginPageWithError(LOGIN_PAGE, {}), `${LOGIN_PAGE}?href=%2F&error`);
        });

        // the login page looks for the flag in window.location.search, so it must not end up
        // behind a fragment
        it('keeps the error flag in the query string', function () {
            const url = getLoginPageWithError(LOGIN_PAGE, form('/cometvisu/?config=demo', '#id_10_'));
            assert.ok(!url.includes('#'), `the error URL must not carry a fragment: ${url}`);
            assert.ok(url.endsWith('&error'), `the error flag must come last: ${url}`);
        });

        it('drops a target that does not belong to this server', function () {
            assert.strictEqual(
                getLoginPageWithError(LOGIN_PAGE, form('https://evil.com/')),
                `${LOGIN_PAGE}?href=%2F&error`,
            );
        });

        // the login page posts its own URL back after stripping the flag, so a second attempt
        // has to arrive at the very same target
        it('survives a second attempt', function () {
            const target = '/cometvisu/?config=p8a&enableCache=false#id_10_';
            const errorPage = getLoginPageWithError(LOGIN_PAGE, form(target));
            const origin = errorPage.replace('&error', '');

            assert.strictEqual(getRedirectPage({ body: { origin } }), target);
        });
    });
});
