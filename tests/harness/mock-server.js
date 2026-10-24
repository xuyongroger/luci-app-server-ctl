'use strict';

/*
 * Local mock rpcd/uci backend + static file server used to exercise the
 * LuCI view (view/serverctl/main.js) in a real browser via playwright.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8077;
const ROOT = __dirname;
const RES = path.join(ROOT, 'resources');
const THEME = path.join(ROOT, 'luci-static');
const PLUGIN_MAIN = path.resolve(ROOT, '..', '..',
	'luci-app-server-ctl', 'htdocs', 'luci-static', 'resources', 'view', 'serverctl', 'main.js');

let sidCounter = 0;
const store = {
	serverctl: {
		cfg000d0: {
			'.name': 'cfg000d0', '.type': 'server', '.index': 0,
			name: 'server1', ip: '192.168.1.10', mac: 'AA:BB:CC:DD:EE:01',
			user: 'root', password: 'pw1'
		},
		cfg000d1: {
			'.name': 'cfg000d1', '.type': 'task', '.index': 1,
			name: 'morning-wake', server: 'server1', action: 'wake',
			schedule: 'daily', hour: '8', minute: '0', enabled: '1'
		}
	},
	luci: {}
};

const MIME = {
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2'
};

function serveStatic(req, res) {
	let p = decodeURIComponent(req.url.split('?')[0]);

	if (p === '/')
		p = '/index.html';

	let file = null;

	if (p === '/luci-static/resources/view/serverctl/main.js')
		file = PLUGIN_MAIN;
	else if (p.startsWith('/luci-static/resources/'))
		file = path.join(RES, p.slice('/luci-static/resources'.length));
	else if (p.startsWith('/luci-static/'))
		file = path.join(THEME, p.slice('/luci-static'.length));
	else if (p === '/index.html')
		file = path.join(ROOT, 'index.html');

	if (p === '/cgi-bin/cgi-exec' || p.startsWith('/cgi-bin/luci/admin/uci/')) {
		res.writeHead(200, { 'Content-Type': MIME['.json'] });
		res.end('{}');
		return;
	}

	if (p === '/admin/menu' || p === '/cgi-bin/luci/admin/menu') {
		res.writeHead(200, { 'Content-Type': MIME['.json'] });
		res.end(JSON.stringify({
			title: 'LuCI',
			satisfied: true,
			readonly: false,
			children: {
				admin: {
					title: 'System',
					satisfied: true,
					readonly: false,
					children: {
						services: {
							title: 'Services',
							satisfied: true,
							readonly: false,
							children: {
								serverctl: {
									title: 'Server Control',
									satisfied: true,
									readonly: false,
									action: { type: 'view', path: 'serverctl/main' }
								}
							}
						}
					}
				}
			}
		}));
		return;
	}

	if (p.startsWith('/luci-static/resources/i18n/')) {
		res.writeHead(200, { 'Content-Type': MIME['.json'] });
		res.end('{}');
		return;
	}

	if (file == null || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		res.writeHead(404);
		res.end('not found');
		return;
	}

	res.writeHead(200, {
		'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
		'Cache-Control': 'no-store'
	});
	fs.createReadStream(file).pipe(res);
}

function ensurePkg(c) {
	if (!store[c])
		store[c] = {};

	return store[c];
}

function nextIndex(pkg) {
	let max = -1;

	for (const sid in pkg)
		max = Math.max(max, pkg[sid]['.index'] ?? -1);

	return max + 1;
}

function handleCall(object, method, args) {
	switch (object + '.' + method) {
	case 'luci.getFeatures':
		return [0, { rpc: true, uhttpd: true, form: true }];

	case 'file.list':
		return [0, { entries: [] }];

	case 'session.access':
		return [0, { access: true }];

	case 'session.datacheck':
		return [0, { changes: {} }];

	case 'uci.get': {
		const c = args?.config;
		return [0, { values: { '.name': c, ...ensurePkg(c) } }];
	}

	case 'uci.order':
		return [0, {}];

	case 'uci.add': {
		const { config, type, name, values } = args ?? {};
		const pkg = ensurePkg(config);
		const sid = name || 'cfg' + (sidCounter++).toString(16).padStart(6, '0');
		const sect = { '.name': sid, '.type': type, '.index': nextIndex(pkg) };

		for (const k in values ?? {})
			sect[k] = String(values[k]);

		pkg[sid] = sect;
		return [0, { section: sid, value: sid }];
	}

	case 'uci.set': {
		const { config, section, values } = args ?? {};
		const pkg = ensurePkg(config);
		const sect = pkg[section] ?? (pkg[section] = {
			'.name': section, '.type': 'section', '.index': nextIndex(pkg)
		});

		for (const k in values ?? {}) {
			if (values[k] == null)
				delete sect[k];
			else
				sect[k] = String(values[k]);
		}
		return [0, {}];
	}

	case 'uci.delete': {
		const { config, section, options } = args ?? {};
		const pkg = ensurePkg(config);

		if (options == null)
			delete pkg[section];
		else
			for (const o of options)
				delete pkg[section]?.[o];

		return [0, {}];
	}

	case 'uci.apply':
		return [0, { action: 'apply-completed' }];

	case 'uci.confirm':
		return [0, {}];

	case 'uci.changes':
		return [0, { changes: {} }];

	case 'serverctl.ping':
		return [0, { code: 0, output: 'PING 192.168.1.10: 64 bytes, time 0.8 ms' }];

	case 'serverctl.sshtest':
		return [0, { code: 0, output: 'SSH connection to root@192.168.1.10 succeeded (mock)' }];

	case 'serverctl.wake':
		return [0, { code: 0, output: 'Wake-on-LAN magic packet sent to AA:BB:CC:DD:EE:01' }];

	case 'serverctl.suspend':
		return [0, { code: 0, output: 'SSH: rtcwake suspend issued (mock)' }];

	case 'serverctl.poweroff':
		return [0, { code: 0, output: 'SSH: poweroff issued (mock)' }];

	default:
		return [0, {}];
	}
}

function handleUBus(req) {
	switch (req.method) {
	case 'list':
		return { result: {} };

	case 'call': {
		const [ , object, method, args ] = req.params ?? [];
		return { result: handleCall(object, method, args) };
	}

	default:
		return { result: {} };
	}
}

function replyUBus(body, res) {
	let msg;

	try {
		msg = JSON.parse(body);
	} catch (err) {
		res.writeHead(400);
		res.end('bad json');
		return;
	}

	const respond = (r) => {
		const out = handleUBus(r);
		return { jsonrpc: '2.0', id: r.id, ...out };
	};

	const payload = Array.isArray(msg) ? msg.map(respond) : respond(msg);

	res.writeHead(200, { 'Content-Type': MIME['.json'] });
	res.end(JSON.stringify(payload));
}

http.createServer((req, res) => {
	if (req.method === 'POST' && req.url.split('?')[0] === '/ubus/') {
		let body = '';

		req.on('data', (d) => { body += d; });
		req.on('end', () => replyUBus(body, res));
		return;
	}

	if (req.method === 'GET') {
		serveStatic(req, res);
		return;
	}

	res.writeHead(405);
	res.end();
}).listen(PORT, '127.0.0.1', () => {
	console.log('mock server on http://127.0.0.1:%d/'.replace('%d', PORT));
});
