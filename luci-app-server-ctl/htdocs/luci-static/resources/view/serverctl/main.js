'use strict';
'require form';
'require rpc';
'require ui';
'require uci';
'require view';

const callPing = rpc.declare({
	object: 'serverctl',
	method: 'ping',
	params: [ 'server' ],
	expect: {}
});

const callSSHTest = rpc.declare({
	object: 'serverctl',
	method: 'sshtest',
	params: [ 'server' ],
	expect: {}
});

const callWake = rpc.declare({
	object: 'serverctl',
	method: 'wake',
	params: [ 'server' ],
	expect: {}
});

const callSuspend = rpc.declare({
	object: 'serverctl',
	method: 'suspend',
	params: [ 'server' ],
	expect: {}
});

const callPoweroff = rpc.declare({
	object: 'serverctl',
	method: 'poweroff',
	params: [ 'server' ],
	expect: {}
});

const actionRPC = {
	ping: callPing,
	sshtest: callSSHTest,
	wake: callWake,
	suspend: callSuspend,
	poweroff: callPoweroff
};

function actionLabel(action) {
	switch (action) {
	case 'ping': return _('Ping Test');
	case 'sshtest': return _('SSH Test');
	case 'wake': return _('Wake');
	case 'suspend': return _('Suspend');
	case 'poweroff': return _('Power Off');
	}
	return action;
}

function confirmDialog(title, body) {
	return new Promise((resolve, reject) => {
		ui.showModal(title, [
			E('p', {}, body),
			E('div', { 'class': 'button-row' }, [
				E('button', {
					'class': 'btn cbi-button',
					'click': () => {
						ui.hideModal();
						reject(new Error('cancelled'));
					}
				}, _('Cancel')), ' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-negative important',
					'click': () => {
						ui.hideModal();
						resolve();
					}
				}, _('Run'))
			])
		]);
	});
}

function pad2(v) {
	return ('0' + String(v)).slice(-2);
}

function nowStamp() {
	const d = new Date();
	return '%s-%s-%s %s:%s:%s'.format(
		d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate()),
		pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds()));
}

function getServers() {
	const list = uci.sections('serverctl', 'server').filter((s) => s['name']);

	list.sort((a, b) => (a['name'] > b['name'] ? 1 : -1));
	return list;
}

function findServer(name) {
	const list = getServers();
	for (const s of list) {
		if (s['name'] == name)
			return s;
	}
	return null;
}

const ManualSection = form.NamedSection.extend({
	selectEl: null,
	outputEl: null,
	infoEls: null,
	passShown: false,
	buttons: null,

	render() {
		const self = this;
		const servers = getServers();
		const legend = E('legend', {}, _('Manual Control'));

		self.buttons = [];

		if (servers.length === 0) {
			const empty = E('div', { 'class': 'alert-message warning' },
				_('No servers configured yet. Please add servers on the "%s" tab first.')
					.format(_('Server Maintenance')));

			const root = E('div', { 'class': 'cbi-section' }, [ legend, empty ]);
			root.setAttribute('data-ctl-area', this.ctlArea);
			return root;
		}

		const options = [ E('option', { value: '' }, _('— Select a server —')) ];
		for (const s of servers)
			options.push(E('option', { value: s['name'] }, s['name']));

		const select = E('select', {
			'class': 'cbi-input-select',
			'style': 'max-width:320px',
			'change': () => self.updateInfo()
		}, options);
		self.selectEl = select;

		self.infoEls = {};
		const mkinfo = (key, label) => {
			const v = E('span', {}, '—');
			self.infoEls[key] = v;
			return [ E('b', {}, label), ' ', v ];
		};

		const infoRows = [
			...mkinfo('name', _('Name')), E('br'),
			...mkinfo('ip', _('IP Address')), E('br'),
			...mkinfo('mac', _('MAC Address')), E('br'),
			...mkinfo('user', _('Username')), E('br'),
			...mkinfo('password', _('Password')),
		];

		const passToggle = E('button', {
			'class': 'btn cbi-button-link',
			'style': 'margin-left:0.5em',
			'click': () => {
				self.passShown = !self.passShown;
				self.updateInfo();
			}
		}, _('Show'));

		infoRows.push(' ', passToggle);

		const mkbtn = (action, cls) => {
			const b = E('button', {
				'class': 'btn cbi-button cbi-button-' + cls,
				'style': 'margin:0.25em',
				'click': () => self.handleAction(action)
			}, actionLabel(action));
			self.buttons.push(b);
			return b;
		};

		const output = E('pre', {
			'style': 'text-align:left;background:#fafafa;border:1px solid #ccc;padding:0.5em;margin:0.5em auto 0 auto;max-width:640px;min-height:2.5em;white-space:pre-wrap;word-break:break-all'
	 }, '');
		self.outputEl = output;

		const body = E('div', { 'style': 'text-align:center;margin:0 auto;max-width:720px' }, [
			E('div', { 'style': 'margin-bottom:0.75em' }, [
				E('b', {}, _('Server')), ' ', select
			]),
			E('div', { 'style': 'margin-bottom:0.75em' }, infoRows),
			E('div', {}, [
				mkbtn('ping', 'action'), ' ',
				mkbtn('sshtest', 'action'), ' ',
				mkbtn('wake', 'positive'), ' ',
				mkbtn('suspend', 'negative'), ' ',
				mkbtn('poweroff', 'negative')
			]),
			output
		]);

		const root = E('div', { 'class': 'cbi-section' }, [ legend, body ]);
		root.setAttribute('data-ctl-area', this.ctlArea);
		return root;
	},

	updateInfo() {
		const name = this.selectEl.value;
		const s = name ? findServer(name) : null;
		const els = this.infoEls;

		els.name.textContent = s ? (s['name'] || '—') : '—';
		els.ip.textContent = s ? (s['ip'] || '—') : '—';
		els.mac.textContent = s ? (s['mac'] || '—') : '—';
		els.user.textContent = s ? (s['user'] || 'root') : '—';

		if (s && s['password'])
			els.password.textContent = this.passShown ? s['password'] : '••••••';
		else
			els.password.textContent = '—';

		const toggle = els.password.parentNode.querySelector('button');
		if (toggle)
			toggle.textContent = this.passShown ? _('Hide') : _('Show');
	},

	appendLine(text) {
		this.outputEl.textContent += text;
		this.outputEl.scrollTop = this.outputEl.scrollHeight;
	},

	setBusy(busy) {
		for (const b of this.buttons)
			b.disabled = busy;
	},

	handleAction(action) {
		const self = this;
		const name = this.selectEl.value;

		if (!name) {
			this.appendLine('[%s] %s\n'.format(nowStamp(), _('Please select a server first.')));
			return;
		}

		const run = () => {
			self.setBusy(true);
			self.appendLine('[%s] %s → %s\n'.format(nowStamp(), actionLabel(action), name));

			return actionRPC[action](name)
				.then((res) => {
					const code = (res && typeof res.code === 'number') ? res.code : -1;
					const out = (res && res.output) ? res.output : '';
					self.appendLine('%s (exit code %d)\n\n'.format(out, code));
				})
				.catch((err) => {
					self.appendLine('%s: %s\n\n'.format(_('Error'), err));
				})
				.then(() => {
					self.setBusy(false);
				});
		};

		if (action === 'suspend' || action === 'poweroff') {
			confirmDialog(
				_('Confirm %s').format(actionLabel(action)),
				_('Are you sure you want to %s the server "%s"?').format(actionLabel(action), name)
			).then(run, () => null);
		}
		else {
			run();
		}
	}
});

const TaggedGridSection = form.GridSection.extend({
	render() {
		return form.GridSection.prototype.render.apply(this, arguments)
			.then((node) => {
				if (node && node.setAttribute)
					node.setAttribute('data-ctl-area', this.ctlArea);
				return node;
			});
	}
});

const ServerCtlMap = form.Map.extend({
	/*
	 * Group the rendered section nodes into the two tab panes while the
	 * child nodes are being rendered, so that re-rendering the whole map
	 * (e.g. after saving a modal dialog) keeps the tab layout intact.
	 */
	renderChildren(tab_name) {
		return form.Map.prototype.renderChildren.apply(this, arguments).then((nodes) => {
			const pane1 = E('div', {
				'class': 'ctl-tabs-pane',
				'data-tab': 'ctl',
				'data-tab-title': _('Manual/Scheduled Control'),
				'data-tab-active': 'true'
			});
			const pane2 = E('div', {
				'class': 'ctl-tabs-pane',
				'data-tab': 'servers',
				'data-tab-title': _('Server Maintenance')
			});

			for (const n of nodes) {
				if (n == null)
					continue;

				if (n.nodeType === 1 && n.getAttribute('data-ctl-area') == 'server')
					pane2.appendChild(n);
				else
					pane1.appendChild(n);
			}

			const wrap = E('div', {});
			wrap.appendChild(pane1);
			wrap.appendChild(pane2);

			this.tabPanes = [pane1, pane2];
			return [wrap];
		});
	},

	renderContents() {
		return form.Map.prototype.renderContents.apply(this, arguments).then((mapEl) => {
			if (this.tabPanes != null) {
				ui.tabs.initTabGroup(this.tabPanes);
				this.tabPanes = null;
			}

			return mapEl;
		});
	}
});

return view.extend({
	load() {
		return uci.load('serverctl');
	},

	render() {
		let m, s, o;

		m = new ServerCtlMap('serverctl', _('Server Control'),
			_('Manually or on a schedule: wake, suspend or power off your LAN servers.'));

		/* --- tab 1: manual control -------------------------------- */
		s = m.section(ManualSection, 'defaults', 'serverctl', _('Manual Control'));
		s.ctlArea = 'manual';

		/* --- tab 1: scheduled tasks ------------------------------- */
		s = m.section(TaggedGridSection, 'task', _('Scheduled Tasks'),
			_('Run wake, suspend or power off actions on a server at a given time.'));
		s.ctlArea = 'task';
		s.anonymous = true;
		s.addremove = true;
		s.addbtntitle = _('Add task');
		s.modaltitle = (sid) => sid ? _('Edit task') : _('Add task');

		o = s.option(form.ListValue, 'server', _('Server'));
		o.rmempty = false;
		o.placeholder = _('— Select a server —');
		for (const srv of getServers())
			o.value(srv['name'], srv['name']);

		o = s.option(form.ListValue, 'action', _('Action'));
		o.rmempty = false;
		o.value('wake', _('Wake'));
		o.value('suspend', _('Suspend'));
		o.value('poweroff', _('Power Off'));

		o = s.option(form.ListValue, 'schedule', _('Schedule'));
		o.rmempty = false;
		o.default = 'daily';
		o.value('daily', _('Daily'));
		o.value('weekly', _('Weekly'));
		o.value('once', _('Once'));

		o = s.option(form.ListValue, 'weekday', _('Weekday'));
		o.depends('schedule', 'weekly');
		o.value('1', _('Monday'));
		o.value('2', _('Tuesday'));
		o.value('3', _('Wednesday'));
		o.value('4', _('Thursday'));
		o.value('5', _('Friday'));
		o.value('6', _('Saturday'));
		o.value('0', _('Sunday'));

		o = s.option(form.Value, 'date', _('Date (YYYY-MM-DD)'));
		o.depends('schedule', 'once');
		o.rmempty = false;
		o.validate = (sid, value) => {
			if (/^\d{4}-\d{2}-\d{2}$/.test(value || ''))
				return true;
			return _('Invalid date, expected format YYYY-MM-DD');
		};

		o = s.option(form.Value, 'hour', _('Hour (0-23)'));
		o.rmempty = false;
		o.datatype = 'range(0,23)';
		o.default = '8';

		o = s.option(form.Value, 'minute', _('Minute (0-59)'));
		o.rmempty = false;
		o.datatype = 'range(0,59)';
		o.default = '0';

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = o.enabled;

		o = s.option(form.DummyValue, '_time', _('Time'));
		o.modalonly = false;
		o.textvalue = (sid) => {
			const hh = uci.get('serverctl', sid, 'hour') || '8';
			const mm = uci.get('serverctl', sid, 'minute') || '0';
			return '%s:%s'.format(pad2(hh), pad2(mm));
		};

		/* Re-read the server list from the UCI store each time the task
		 * modal opens, so servers added on the "Server Maintenance" tab
		 * without a page reload are offered right away. */
		s.addModalOptions = (modalSection) => {
			for (const opt of modalSection.children) {
				if (opt.option !== 'server')
					continue;

				opt.keylist = [];
				opt.vallist = [];

				for (const srv of getServers())
					opt.value(srv['name'], srv['name']);
			}
		};

		/* --- tab 2: server maintenance ---------------------------- */
		s = m.section(TaggedGridSection, 'server', _('Server Maintenance'),
			_('Manage the server inventory used by manual and scheduled control.'));
		s.ctlArea = 'server';
		s.anonymous = true;
		s.addremove = true;
		s.addbtntitle = _('Add server');
		s.modaltitle = (sid) => sid ? _('Edit server') : _('Add server');

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;
		o.datatype = 'string';
		o.validate = (sid, value) => {
			const v = (value || '').trim();
			for (const srv of getServers()) {
				if (srv['name'] === v && srv['.name'] !== sid)
					return _('Duplicate server name');
			}
			return true;
		};

		o = s.option(form.Value, 'ip', _('IP Address'));
		o.rmempty = false;
		o.datatype = 'or(ip4addr,hostname)';

		o = s.option(form.Value, 'mac', _('MAC Address'));
		o.rmempty = false;
		o.datatype = 'macaddr';

		o = s.option(form.Value, 'user', _('Username'));
		o.default = 'root';

		o = s.option(form.Value, 'password', _('Password'));

		return m.render();
	}
});
