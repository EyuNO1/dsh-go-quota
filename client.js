/**
 * Go multi-account quota cards — client half.
 *
 * A frame-wide floating deck: every OpenCode Go subscription key is one card
 * with its 5h / weekly / monthly quota. Clicking a card switches the shared
 * OPENCODE_GO_API_KEY to that account; the account in use shrinks to a compact
 * bar (its detail lives in the bottom-left balance panel), and the whole deck
 * can collapse to a small pill without covering the conversation.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-go-quota',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const STORAGE_KEY = 'dsh-go-quota:collapsed'
    const POS_KEY = 'dsh-go-quota:pos'
    const COLS_KEY = 'dsh-go-quota:layout'
    const STARRED_KEY = 'dsh-go-quota:starred'
    // Keep the widget below the app header / window drag strip so its header
    // stays clickable at the top edge.
    const MIN_TOP = 84
    const MIN_LEFT = 8
    let clientCtx = null

    const CSS = `
      .goq-root{position:fixed;top:84px;right:22px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;font-family:inherit;color:var(--dsw-alias-label-primary)}
      .goq-panel{width:280px;max-width:calc(100vw - 28px);max-height:min(64vh,620px);display:flex;flex-direction:column;pointer-events:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.32);overflow:hidden;backdrop-filter:blur(14px);animation:goq-panel-in .32s cubic-bezier(.2,.9,.25,1.08) both;transition:width .32s cubic-bezier(.2,.9,.25,1.08);-webkit-app-region:no-drag;app-region:no-drag}
      .goq-panel.is-closing{animation:goq-panel-out .22s cubic-bezier(.4,0,1,1) forwards;pointer-events:none}
      .goq-head{display:flex;align-items:center;gap:7px;padding:10px 10px 7px 12px;flex:none;cursor:grab;user-select:none;touch-action:none}
      .goq-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}
      .goq-dot.goq-tone-ok{background:var(--dsw-alias-brand-primary)}
      .goq-dot.goq-tone-warn{background:var(--dsw-alias-state-warn-primary)}
      .goq-dot.goq-tone-bad{background:var(--dsw-alias-state-error-primary)}
      .goq-title{font-size:12.5px;font-weight:650;letter-spacing:.01em}
      .goq-count{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .goq-spacer{flex:1}
      .goq-iconbtn{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;padding:0;flex:none}
      .goq-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .goq-iconbtn:disabled{opacity:.45;cursor:default}
      .goq-layout{width:24px;min-width:24px;padding:0}
      .goq-layout-icon{display:block;transform-origin:center;animation:goq-layout-in .22s cubic-bezier(.2,.9,.25,1.2)}
      .goq-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));align-content:start;gap:7px;padding:0 10px 8px;overflow-y:auto;overscroll-behavior:contain;min-height:0}
      .goq-active{grid-column:1/-1;display:flex;align-items:center;gap:7px;padding:8px 10px;border-radius:11px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 36%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,var(--dsw-alias-bg-layer-1));flex:none;animation:goq-item-in .34s cubic-bezier(.2,.8,.2,1) backwards}
      .goq-live{display:inline-flex;align-items:center;font-size:10px;font-weight:600;color:var(--dsw-alias-state-success-primary);flex:none}
      .goq-active-metric{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:none;white-space:nowrap}
      .goq-active-metric.is-error{color:var(--dsw-alias-state-error-primary)}
      .goq-active-window{color:var(--dsw-alias-label-primary)}
      .goq-active-window.is-muted{color:var(--dsw-alias-label-secondary)}
      .goq-active-window.is-warn{color:var(--dsw-alias-state-warn-primary)}
      .goq-active-window.is-bad{color:var(--dsw-alias-state-error-primary)}
      .goq-active-sep{color:var(--dsw-alias-label-secondary);opacity:.55}
      .goq-card{position:relative;min-width:0;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:11px;padding:9px 10px 8px;cursor:pointer;outline:none;transition:border-color .15s ease,background .15s ease,transform .15s ease;animation:goq-item-in .34s cubic-bezier(.2,.8,.2,1) backwards}
      .goq-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);transform:translateY(-1px)}
      .goq-card:focus-visible{border-color:var(--dsw-alias-brand-primary)}
      .goq-card[data-switching="true"]{opacity:.7;cursor:progress}
      .goq-card[data-unusable="true"]:hover{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-border-l1))}
      .goq-row{display:flex;align-items:center;gap:6px;min-width:0}
      .goq-name{font-size:12.5px;font-weight:650;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .goq-mask{font-size:9.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:none;margin-left:2px}
      .goq-del{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:1;padding:2px 4px;border-radius:5px;flex:none}
      .goq-del:hover{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
      .goq-del.is-confirm{color:var(--dsw-alias-state-error-primary);font-size:10px;font-weight:650;padding:2px 5px}
      .goq-star{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;padding:0;border-radius:4px;cursor:pointer;flex:none;color:var(--dsw-alias-label-secondary);opacity:.72;transition:color .15s ease,opacity .15s ease,transform .15s ease}
      .goq-star:hover{opacity:1;color:var(--dsw-alias-label-primary);transform:scale(1.08)}
      .goq-star:active{transform:scale(.92)}
      .goq-star.is-starred{opacity:1;color:var(--dsw-alias-state-warn-primary)}
      .goq-star svg{display:block}
      .goq-wrow{display:grid;grid-template-columns:24px minmax(0,1fr) 32px 34px;align-items:center;gap:6px;margin-top:5px}
      .goq-wlabel{font-size:10px;color:var(--dsw-alias-label-secondary)}
      .goq-track{height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
      .goq-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);transition:width .35s ease}
      .goq-fill.is-warn{background:var(--dsw-alias-state-warn-primary)}
      .goq-fill.is-bad{background:var(--dsw-alias-state-error-primary)}
      .goq-pct{font-size:10.5px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
      .goq-pct.is-muted{color:var(--dsw-alias-label-secondary)}
      .goq-pct.is-warn{color:var(--dsw-alias-state-warn-primary)}
      .goq-pct.is-bad{color:var(--dsw-alias-state-error-primary)}
      .goq-reset{font-size:9.5px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
      .goq-error{margin-top:6px;display:flex;align-items:flex-start;gap:5px;font-size:10px;line-height:1.45;color:var(--dsw-alias-state-error-primary)}
      .goq-empty{grid-column:1/-1;border:1px dashed var(--dsw-alias-border-l2);border-radius:11px;padding:12px 10px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.65}
      .goq-empty-title{display:block;color:var(--dsw-alias-label-primary);font-size:11.5px;font-weight:650;margin-bottom:3px}
      .goq-banner{margin:0 10px 7px;padding:6px 8px;border-radius:7px;font-size:10px;line-height:1.45;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
      .goq-foot{display:flex;align-items:center;gap:8px;padding:7px 12px 8px;border-top:1px solid var(--dsw-alias-border-l1);flex:none}
      .goq-add{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-family:inherit;font-size:11px;font-weight:650;cursor:pointer;padding:2px 0;border-radius:5px}
      .goq-add:hover{text-decoration:underline}
      .goq-stamp{margin-left:auto;font-size:9px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .goq-form{grid-column:1/-1;display:flex;flex-direction:column;gap:7px;padding:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}
      .goq-form-title{font-size:11px;font-weight:650}
      .goq-label{font-size:9.5px;color:var(--dsw-alias-label-secondary);margin-bottom:3px;display:block}
      .goq-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:7px;padding:6px 7px;font-family:inherit;font-size:11px;outline:none}
      .goq-input:focus{border-color:var(--dsw-alias-brand-primary)}
      .goq-form-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:1px}
      .goq-btn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;border-radius:7px;padding:4px 10px;font-size:10.5px;cursor:pointer}
      .goq-btn:hover{background:var(--dsw-alias-bg-layer-2)}
      .goq-btn.primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:650}
      .goq-btn:disabled{opacity:.45;cursor:default}
      .goq-form-error{font-size:9.5px;line-height:1.45;color:var(--dsw-alias-state-error-primary)}
      .goq-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;height:29px;max-width:calc(100vw - 40px);padding:0 11px;border-radius:15px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 6px 20px rgba(0,0,0,.24);cursor:grab;user-select:none;touch-action:none;font-family:inherit;font-size:11px;backdrop-filter:blur(12px);animation:goq-pill-in .3s cubic-bezier(.2,.9,.25,1.2) both;-webkit-app-region:no-drag;app-region:no-drag}
      .goq-root.is-dragging .goq-head,.goq-root.is-dragging .goq-pill{cursor:grabbing}
      .goq-root.is-dragging .goq-panel,.goq-root.is-dragging .goq-pill{box-shadow:0 22px 58px rgba(0,0,0,.42)}
      .goq-pill:hover{border-color:var(--dsw-alias-brand-primary)}
      .goq-pill-name{font-weight:650;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .goq-pill-value{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
      .goq-spin{animation:goq-spin .9s linear infinite}
      @keyframes goq-spin{to{transform:rotate(360deg)}}
      @keyframes goq-panel-in{from{opacity:0;transform:translateY(6px) scale(.94)}60%{opacity:1;transform:translateY(-1px) scale(1.004)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes goq-panel-out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(5px) scale(.96)}}
      @keyframes goq-item-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
      @keyframes goq-pill-in{from{opacity:0;transform:scale(.82)}65%{opacity:1;transform:scale(1.04)}to{opacity:1;transform:scale(1)}}
      @keyframes goq-layout-in{from{opacity:0;transform:scale(.78)}to{opacity:1;transform:scale(1)}}
      @media (prefers-reduced-motion:reduce){.goq-panel,.goq-card,.goq-active,.goq-pill{animation:none!important}.goq-card,.goq-pill,.goq-fill{transition:none!important}.goq-panel{transition:none!important}.goq-layout-icon{animation:none!important}}
      @media (max-width:720px){.goq-root{top:70px;right:10px}}
    `

    const TEXT = {
      zh: {
        title: 'Go 账号',
        count: (n) => n + ' 个账号',
        active: '使用中',
        refresh: '刷新额度',
        collapse: '收起卡片',
        expand: '展开 Go 账号卡片',
        dragHint: '拖动可移动，点击展开',
        dragDeck: '按住标题栏拖动卡片组',
        layoutAuto: '自动',
        layoutOne: '1列',
        layoutTwo: '2列',
        layoutHint: '切换卡片布局',
        add: '添加账号',
        cancel: '取消',
        addTitle: '添加 Go 账号',
        nameLabel: '账号名',
        namePlaceholder: '例如：主号 / 小号',
        keyLabel: 'API Key',
        keyPlaceholder: 'oc_... 订阅 Key',
        save: '添加',
        saving: '添加中…',
        emptyTitle: '还没有 Go 账号',
        emptyHint: '填入 OpenCode Go 订阅 Key，每个账号会显示一张额度卡片。',
        loading: '读取额度…',
        updated: (time) => '更新于 ' + time,
        h: '5h',
        w: '周',
        m: '月',
        resetAt: '重置时间：',
        delete: '删除账号',
        confirmDelete: '确认删除',
        star: '标记为重要',
        unstar: '取消重要标记',
        activateHint: '点击切换到该账号',
        unusableHint: '这个 Key 的额度查询失败，无法切换',
        switching: '切换中…',
        activeHint: '当前使用的账号；5h / 周 / 月额度都在这里，点右上角刷新',
        quotaError: '额度异常',
        unusable: '这个 Key 无效或没有 Go 订阅，未切换。',
        noAccount: '账号不存在，请刷新后重试。',
        switchTimeout: '切换超时，请重试。',
        errors: {
          unauthorized: 'Key 无效或已过期',
          forbidden: '该 Key 没有 Go 订阅',
          timeout: '额度查询超时',
          network: '网络错误，额度未取到',
          payload: '额度接口返回异常',
          http: '额度接口出错',
          pending: '等待查询',
        },
        server: {
          'duplicate-key': '这个 Key 已经添加过了。',
          'invalid-name': '账号名不能为空，且不能超过 48 个字符。',
          'invalid-key': 'API Key 不能为空，且不能包含空格或换行。',
          'key-unusable': '这个 Key 无效或没有 Go 订阅，未切换。',
          'credentials-unavailable': '宿主没有可用的凭据服务，无法切换。',
          'write-failed': '写入凭据失败，未切换。',
          'not-found': '账号不存在。',
          'forbidden-origin': '请求来源不受信任。',
        },
        fallbackError: '操作失败',
        loadFailed: '额度读取失败：',
      },
      en: {
        title: 'Go accounts',
        count: (n) => n + (n === 1 ? ' account' : ' accounts'),
        active: 'In use',
        refresh: 'Refresh quotas',
        collapse: 'Collapse cards',
        expand: 'Open Go account cards',
        dragHint: 'Drag to move · click to open',
        dragDeck: 'Drag the title bar to move the cards',
        layoutAuto: 'Auto',
        layoutOne: '1 col',
        layoutTwo: '2 cols',
        layoutHint: 'Switch card layout',
        add: 'Add account',
        cancel: 'Cancel',
        addTitle: 'Add a Go account',
        nameLabel: 'Account name',
        namePlaceholder: 'e.g. main / backup',
        keyLabel: 'API key',
        keyPlaceholder: 'oc_... subscription key',
        save: 'Add',
        saving: 'Adding…',
        emptyTitle: 'No Go accounts yet',
        emptyHint: 'Paste an OpenCode Go subscription key to show one quota card per account.',
        loading: 'Reading quotas…',
        updated: (time) => 'Updated ' + time,
        h: '5h',
        w: 'Week',
        m: 'Month',
        resetAt: 'Resets at ',
        delete: 'Delete account',
        confirmDelete: 'Confirm',
        star: 'Mark as important',
        unstar: 'Clear important mark',
        activateHint: 'Click to switch to this account',
        unusableHint: 'This key failed its quota check and cannot be switched to',
        switching: 'Switching…',
        activeHint: 'Active account; 5h / week / month quotas are shown here — refresh at the top right',
        quotaError: 'Quota error',
        unusable: 'This key is invalid or has no Go subscription; not switched.',
        noAccount: 'Account not found. Refresh and try again.',
        switchTimeout: 'Switch timed out. Try again.',
        errors: {
          unauthorized: 'Invalid or expired key',
          forbidden: 'No Go subscription on this key',
          timeout: 'Quota check timed out',
          network: 'Network error; quota unavailable',
          payload: 'Unexpected quota response',
          http: 'Quota endpoint error',
          pending: 'Waiting for the check',
        },
        server: {
          'duplicate-key': 'This key is already added.',
          'invalid-name': 'The account name must not be empty and cannot exceed 48 characters.',
          'invalid-key': 'The API key must not be empty and cannot contain spaces or line breaks.',
          'key-unusable': 'This key is invalid or has no Go subscription; not switched.',
          'credentials-unavailable': 'No credential service is available in this Host; cannot switch.',
          'write-failed': 'Writing the credential failed; not switched.',
          'not-found': 'That account does not exist.',
          'forbidden-origin': 'The request origin is not trusted.',
        },
        fallbackError: 'Request failed',
        loadFailed: 'Could not read quotas: ',
      },
    }

    // ── helpers ────────────────────────────────────────────────────────────

    function pickLocale() {
      try {
        const active = clientCtx?.get?.('locale')?.getSnapshot?.()?.active
        if (typeof active === 'string' && active) return active
      } catch {}
      try {
        return navigator.language || 'zh'
      } catch {
        return 'zh'
      }
    }

    function useLocaleId() {
      const [id, setId] = useState(pickLocale)
      useEffect(() => {
        let service
        try {
          service = clientCtx?.get?.('locale')
        } catch {}
        if (!service || typeof service.subscribe !== 'function') return undefined
        const read = () => {
          try {
            setId(service.getSnapshot?.()?.active || pickLocale())
          } catch {}
        }
        read()
        return service.subscribe(read)
      }, [])
      return id
    }

    function toneOf(percent) {
      if (percent === null || percent === undefined) return 'idle'
      if (percent >= 90) return 'bad'
      if (percent >= 70) return 'warn'
      return 'ok'
    }

    function windowPercent(value) {
      return value && typeof value.percent === 'number' && Number.isFinite(value.percent) ? value.percent : null
    }

    function worstOf(account) {
      if (!account || account.ok !== true) return null
      const values = [account.rolling, account.weekly, account.monthly]
        .map(windowPercent)
        .filter((value) => value !== null)
      return values.length ? Math.max(...values) : null
    }

    function formatReset(iso, zh) {
      const ms = Date.parse(iso) - Date.now()
      if (!Number.isFinite(ms)) return ''
      if (ms <= 0) return '0m'
      const minutes = Math.round(ms / 60000)
      if (minutes < 60) return minutes + 'm'
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return hours + 'h'
      return Math.floor(hours / 24) + 'd'
    }

    function formatStamp(iso, zh) {
      try {
        return new Date(iso).toLocaleTimeString(zh ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    function prefersReducedMotion() {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch {
        return false
      }
    }

    function percentLabel(value) {
      return value === null || value === undefined ? '—' : Math.round(value) + '%'
    }

    function loadCollapsed() {
      try {
        const raw = readCookie('dsh_goq_collapsed')
        if (raw === '1') return true
        if (raw === '0') return false
      } catch {}
      try {
        return window.localStorage.getItem(STORAGE_KEY) === '1'
      } catch {
        return false
      }
    }

    function storeCollapsed(value) {
      writeCookie('dsh_goq_collapsed', value ? '1' : '0')
      try {
        window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
      } catch {}
    }

    function readCookie(name) {
      try {
        const prefix = name + '='
        for (const part of String(document.cookie || '').split(';')) {
          const trimmed = part.trim()
          if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length))
        }
      } catch {}
      return ''
    }

    function writeCookie(name, value) {
      try {
        document.cookie = value === null || value === undefined
          ? name + '=; path=/; max-age=0; SameSite=Lax'
          : name + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; SameSite=Lax'
      } catch {}
    }

    function loadPos() {
      // A cookie is scoped by host, not port: the desktop app moves to a new
      // 127.0.0.1 port on every start, while localStorage is port-keyed.
      try {
        const raw = readCookie('dsh_goq_pos')
        if (raw) {
          const [x, y] = raw.split(',').map(Number)
          if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.max(MIN_LEFT, x), y: Math.max(MIN_TOP, y) }
        }
      } catch {}
      try {
        const raw = JSON.parse(window.localStorage.getItem(POS_KEY) || 'null')
        if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
          return { x: Math.max(MIN_LEFT, raw.x), y: Math.max(MIN_TOP, raw.y) }
        }
      } catch {}
      return null
    }

    function savePos(value) {
      if (value) {
        writeCookie('dsh_goq_pos', Math.round(value.x) + ',' + Math.round(value.y))
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify(value))
        } catch {}
      } else {
        writeCookie('dsh_goq_pos', null)
        try {
          window.localStorage.removeItem(POS_KEY)
        } catch {}
      }
    }

    function loadCols() {
      try {
        const raw = readCookie('dsh_goq_layout')
        if (raw === '1') return 1
        if (raw === '2') return 2
        if (raw === 'auto') return null
      } catch {}
      try {
        const raw = window.localStorage.getItem(COLS_KEY)
        if (raw === '1') return 1
        if (raw === '2') return 2
      } catch {}
      return null
    }

    function storeCols(value) {
      writeCookie('dsh_goq_layout', value === null ? 'auto' : String(value))
      try {
        if (value === null) window.localStorage.removeItem(COLS_KEY)
        else window.localStorage.setItem(COLS_KEY, String(value))
      } catch {}
    }

    function loadStarred() {
      try {
        const raw = readCookie('dsh_goq_starred')
        if (raw) return raw.split(',').filter(Boolean)
      } catch {}
      try {
        const raw = JSON.parse(window.localStorage.getItem(STARRED_KEY) || '[]')
        if (Array.isArray(raw)) return raw.filter((id) => typeof id === 'string')
      } catch {}
      return []
    }

    function saveStarred(ids) {
      const list = [...ids]
      writeCookie('dsh_goq_starred', list.join(','))
      try {
        window.localStorage.setItem(STARRED_KEY, JSON.stringify(list))
      } catch {}
    }

    function serverMessage(payload, t) {
      const code = payload && typeof payload.code === 'string' ? payload.code : ''
      if (code && t.server[code]) return t.server[code]
      return (payload && typeof payload.error === 'string' && payload.error) || t.fallbackError
    }

    function quotaError(account, t) {
      const code = account && typeof account.code === 'string' ? account.code : 'http'
      const base = t.errors[code] || t.errors.http
      if (account && typeof account.error === 'string' && account.error && code !== 'unauthorized' && code !== 'forbidden') {
        return base + ' · ' + account.error
      }
      return base
    }

    function unusable(account) {
      return account && account.ok !== true && (account.code === 'unauthorized' || account.code === 'forbidden')
    }

    async function request(path, body, t) {
      const init = body === undefined
        ? { headers: { accept: 'application/json' } }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
          }
      let response
      try {
        response = await fetch('/go-quota' + path, init)
      } catch (error) {
        throw new Error(t.fallbackError + '：' + String((error && error.message) || error))
      }
      let payload = null
      try {
        payload = await response.json()
      } catch {}
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error(serverMessage(payload, t))
      }
      return payload
    }

    // ── icons ──────────────────────────────────────────────────────────────

    function RefreshIcon(props) {
      return h('svg', {
        width: 13,
        height: 13,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: props.spin ? 'goq-spin' : undefined,
        'aria-hidden': true,
      },
        h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
        h('path', { d: 'M21 3v6h-6' }))
    }

    function ChevronIcon() {
      return h('svg', {
        width: 13,
        height: 13,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, h('path', { d: 'M6 15l6-6 6 6' }))
    }

    /**
     * Column-layout hint: left/right boundary lines, one or two cards in the
     * middle, and an arrowed line above them pointing out to both boundaries.
     */
    function LayoutIcon(props) {
      const two = props.columns === true
      return h('svg', {
        className: 'goq-layout-icon',
        width: 19,
        height: 15,
        viewBox: '0 0 20 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M2 2.8v10.8M18 2.8v10.8' }),
        h('g', { strokeWidth: 0.9 },
          h('path', { d: 'M2 4.2h16' }),
          h('path', { d: 'M2 4.2l3.2-1.1M2 4.2l3.2 1.1' }),
          h('path', { d: 'M18 4.2l-3.2-1.1M18 4.2l-3.2 1.1' })),
        two
          ? h(React.Fragment, null,
              h('rect', { x: 4.5, y: 7, width: 4.6, height: 6, rx: 1.2, fill: 'currentColor', fillOpacity: 0.14 }),
              h('rect', { x: 10.9, y: 7, width: 4.6, height: 6, rx: 1.2, fill: 'currentColor', fillOpacity: 0.14 }))
          : h('rect', { x: 7.7, y: 7, width: 4.6, height: 6, rx: 1.2, fill: 'currentColor', fillOpacity: 0.14 }))
    }

    const STAR_PATH = 'M12 2 L14.47 8.6 L21.51 8.91 L15.99 13.3 L17.88 20.09 L12 16.2 L6.12 20.09 L8.01 13.3 L2.49 8.91 L9.53 8.6 Z'

    function StarIcon() {
      return h('svg', {
        width: 12,
        height: 12,
        viewBox: '0 0 24 24',
        'aria-hidden': true,
      }, h('path', { d: STAR_PATH, fill: 'currentColor' }))
    }

    // ── pieces ─────────────────────────────────────────────────────────────

    function WindowRow(props) {
      const { label, win, zh, t } = props
      const percent = windowPercent(win)
      const tone = toneOf(percent)
      const reset = win && win.resetsAt ? formatReset(win.resetsAt, zh) : ''
      const exact = win && win.resetsAt ? new Date(win.resetsAt).toLocaleString(zh ? 'zh-CN' : 'en-US') : ''
      const title = exact ? t.resetAt + exact : undefined
      return h('div', { className: 'goq-wrow' },
        h('span', { className: 'goq-wlabel' }, label),
        h('div', { className: 'goq-track' },
          h('div', {
            className: 'goq-fill' + (tone === 'warn' ? ' is-warn' : tone === 'bad' ? ' is-bad' : ''),
            style: { width: (percent === null ? 0 : Math.max(0, Math.min(100, percent))) + '%' },
          })),
        h('span', {
          className: 'goq-pct' + (percent === null ? ' is-muted' : tone === 'warn' ? ' is-warn' : tone === 'bad' ? ' is-bad' : ''),
          title,
        }, percentLabel(percent)),
        h('span', { className: 'goq-reset', title }, reset ? '↻' + reset : ''))
    }

    function ActiveBar(props) {
      const { account, zh, t, switching, starred, onStar } = props
      const tone = account.ok ? toneOf(worstOf(account)) : 'idle'
      const windows = [
        { label: t.h, win: account.rolling },
        { label: t.w, win: account.weekly },
        { label: t.m, win: account.monthly },
      ]
      return h('div', { className: 'goq-active', title: t.activeHint },
        h('span', { className: 'goq-dot goq-tone-' + tone }),
        h('span', { className: 'goq-name', title: account.name }, account.name),
        h('button', {
          type: 'button',
          className: 'goq-star' + (starred ? ' is-starred' : ''),
          title: starred ? t.unstar : t.star,
          'aria-label': starred ? t.unstar : t.star,
          'aria-pressed': starred ? 'true' : 'false',
          onClick: () => onStar(account.id),
        }, h(StarIcon)),
        h('span', { className: 'goq-live' }, switching ? t.switching : t.active),
        account.ok
          ? h('span', { className: 'goq-active-metric' },
              windows.map((entry, index) => {
                const value = windowPercent(entry.win)
                const valueTone = toneOf(value)
                const exact = entry.win && entry.win.resetsAt
                  ? new Date(entry.win.resetsAt).toLocaleString(zh ? 'zh-CN' : 'en-US')
                  : ''
                return h(React.Fragment, { key: entry.label },
                  index > 0 ? h('span', { className: 'goq-active-sep' }, '·') : null,
                  h('span', {
                    className: 'goq-active-window'
                      + (value === null ? ' is-muted' : valueTone === 'warn' ? ' is-warn' : valueTone === 'bad' ? ' is-bad' : ''),
                    title: exact ? t.resetAt + exact : undefined,
                  }, entry.label + ' ' + percentLabel(value)))
              }))
          : h('span', { className: 'goq-active-metric is-error' }, quotaError(account, t)))
    }

    function QuotaCard(props) {
      const { account, zh, t, index, switching, starred, onStar, onActivate, onDelete } = props
      const [confirm, setConfirm] = useState(false)
      useEffect(() => {
        if (!confirm) return undefined
        const timer = setTimeout(() => setConfirm(false), 4000)
        return () => clearTimeout(timer)
      }, [confirm])
      const bad = unusable(account)
      const title = bad ? t.unusableHint : t.activateHint
      return h('div', {
        className: 'goq-card',
        role: 'button',
        tabIndex: 0,
        title,
        style: { animationDelay: Math.min(Number(index) || 0, 8) * 28 + 'ms' },
        'data-switching': switching ? 'true' : undefined,
        'data-unusable': bad ? 'true' : undefined,
        'aria-busy': switching || undefined,
        onClick: () => {
          if (!switching) onActivate(account.id)
        },
        onPointerUp: (event) => {
          if (event.button !== 0) return
          const target = event.target
          if (target && typeof target.closest === 'function' && target.closest('button')) return
          if (!switching) onActivate(account.id)
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (!switching) onActivate(account.id)
          }
        },
      },
        h('div', { className: 'goq-row' },
          h('span', { className: 'goq-dot goq-tone-' + (account.ok ? toneOf(worstOf(account)) : 'idle') }),
          h('span', { className: 'goq-name', title: account.name }, account.name),
          h('button', {
            type: 'button',
            className: 'goq-star' + (starred ? ' is-starred' : ''),
            title: starred ? t.unstar : t.star,
            'aria-label': starred ? t.unstar : t.star,
            'aria-pressed': starred ? 'true' : 'false',
            onClick: (event) => {
              event.stopPropagation()
              onStar(account.id)
            },
            onKeyDown: (event) => event.stopPropagation(),
          }, h(StarIcon)),
          h('span', { className: 'goq-mask' }, switching ? t.switching : account.keyMasked),
          h('button', {
            type: 'button',
            className: 'goq-del' + (confirm ? ' is-confirm' : ''),
            title: confirm ? t.confirmDelete : t.delete,
            'aria-label': confirm ? t.confirmDelete : t.delete,
            onClick: (event) => {
              event.stopPropagation()
              if (confirm) onDelete(account.id)
              else setConfirm(true)
            },
            onKeyDown: (event) => event.stopPropagation(),
          }, confirm ? t.confirmDelete : '×')),
        account.ok
          ? h('div', null,
              h(WindowRow, { label: t.h, win: account.rolling, zh, t }),
              h(WindowRow, { label: t.w, win: account.weekly, zh, t }),
              h(WindowRow, { label: t.m, win: account.monthly, zh, t }))
          : h('div', { className: 'goq-error' },
              h('span', null, '⚠'),
              h('span', null, quotaError(account, t))))
    }

    function AddForm(props) {
      const { t, busy, onAdd, onCancel } = props
      const [name, setName] = useState('')
      const [key, setKey] = useState('')
      const [error, setError] = useState('')
      const submit = async () => {
        if (busy) return
        const accountName = name.trim()
        const accountKey = key.trim()
        if (!accountName || !accountKey) {
          setError(t.server['invalid-name'])
          return
        }
        setError('')
        try {
          await onAdd(accountName, accountKey)
          setName('')
          setKey('')
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }
      return h('div', { className: 'goq-form' },
        h('div', { className: 'goq-form-title' }, t.addTitle),
        h('label', null,
          h('span', { className: 'goq-label' }, t.nameLabel),
          h('input', {
            className: 'goq-input',
            value: name,
            autoFocus: true,
            maxLength: 48,
            placeholder: t.namePlaceholder,
            spellCheck: false,
            onChange: (event) => setName(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            },
          })),
        h('label', null,
          h('span', { className: 'goq-label' }, t.keyLabel),
          h('input', {
            className: 'goq-input',
            value: key,
            type: 'password',
            autoComplete: 'off',
            placeholder: t.keyPlaceholder,
            spellCheck: false,
            onChange: (event) => setKey(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            },
          })),
        error ? h('div', { className: 'goq-form-error' }, error) : null,
        h('div', { className: 'goq-form-actions' },
          h('button', { type: 'button', className: 'goq-btn', onClick: onCancel, disabled: busy }, t.cancel),
          h('button', {
            type: 'button',
            className: 'goq-btn primary',
            onClick: submit,
            disabled: busy || !name.trim() || !key.trim(),
          }, busy ? t.saving : t.save)))
    }

    function Pill(props) {
      const { account, count, t, dragging, onOpen, onDragStart, onDragMove, onDragEnd } = props
      const percent = worstOf(account)
      const rolling = account ? windowPercent(account.rolling) : null
      const tone = account ? (account.ok ? toneOf(percent) : 'idle') : 'idle'
      const label = account ? account.name : t.title
      const value = account ? '5h ' + percentLabel(rolling) : String(count || '')
      const detail = account
        ? [t.h + ' ' + percentLabel(windowPercent(account.rolling)),
           t.w + ' ' + percentLabel(windowPercent(account.weekly)),
           t.m + ' ' + percentLabel(windowPercent(account.monthly))].join(' · ')
        : ''
      return h('button', {
        type: 'button',
        className: 'goq-pill' + (dragging ? ' is-dragging' : ''),
        title: detail ? t.dragHint + ' · ' + detail : t.dragHint,
        'aria-label': t.expand,
        onClick: onOpen,
        onPointerDown: onDragStart,
        onPointerMove: onDragMove,
        onPointerUp: onDragEnd,
        onPointerCancel: onDragEnd,
      },
        h('span', { className: 'goq-dot goq-tone-' + tone }),
        h('span', { className: 'goq-pill-name' }, label),
        value ? h('span', { className: 'goq-pill-value' }, value) : null)
    }

    // ── deck ───────────────────────────────────────────────────────────────

    function GoQuotaDeck() {
      const locale = useLocaleId()
      const zh = String(locale || '').toLowerCase().startsWith('zh')
      const t = zh ? TEXT.zh : TEXT.en

      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [refreshing, setRefreshing] = useState(false)
      const [loadError, setLoadError] = useState('')
      const [actionError, setActionError] = useState('')
      const [switching, setSwitching] = useState('')
      const [adding, setAdding] = useState(false)
      const [busy, setBusy] = useState(false)
      const [collapsed, setCollapsedState] = useState(loadCollapsed)
      const [panelMounted, setPanelMounted] = useState(() => !loadCollapsed())
      const [closing, setClosing] = useState(false)
      const [pos, setPos] = useState(loadPos)
      const [manualCols, setManualCols] = useState(loadCols)
      const [layoutEpoch, setLayoutEpoch] = useState(0)
      const [starredIds, setStarredIds] = useState(() => new Set(loadStarred()))
      const [dragging, setDragging] = useState(false)

      const rootRef = useRef(null)
      const dragRef = useRef(null)
      const suppressClick = useRef(0)
      const closeTimer = useRef(null)
      const posRef = useRef(pos)
      const lastSwitchAt = useRef(0)

      const dataRef = useRef(null)
      useEffect(() => {
        dataRef.current = data
      }, [data])

      useEffect(() => {
        posRef.current = pos
      }, [pos])

      useEffect(() => {
        // Migrate a position saved before the cookie existed, and keep both UI
        // preferences across a restart that lands on a different local port.
        if (pos) savePos(pos)
        storeCollapsed(collapsed)
        storeCols(manualCols)
        saveStarred(starredIds)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const openDeck = useCallback(() => {
        if (closeTimer.current !== null) {
          clearTimeout(closeTimer.current)
          closeTimer.current = null
        }
        setClosing(false)
        setCollapsedState(false)
        setPanelMounted(true)
        storeCollapsed(false)
      }, [])

      const closeDeck = useCallback(() => {
        if (closeTimer.current !== null) return
        setClosing(true)
        const delay = prefersReducedMotion() ? 0 : 240
        closeTimer.current = setTimeout(() => {
          closeTimer.current = null
          setClosing(false)
          setCollapsedState(true)
          setPanelMounted(false)
          storeCollapsed(true)
        }, delay)
      }, [])

      const toggleStar = useCallback((id) => {
        setStarredIds((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          saveStarred(next)
          return next
        })
      }, [])

      useEffect(() => () => {
        if (closeTimer.current !== null) clearTimeout(closeTimer.current)
      }, [])

      const startDrag = useCallback((event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const root = rootRef.current
        if (!root) return
        const rect = root.getBoundingClientRect()
        dragRef.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          startX: event.clientX,
          startY: event.clientY,
          x: rect.left,
          y: rect.top,
          moved: false,
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {}
      }, [])

      const moveDrag = useCallback((event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
        if (!drag.moved) {
          drag.moved = true
          setDragging(true)
        }
        const root = rootRef.current
        if (!root) return
        const maxX = Math.max(0, window.innerWidth - root.offsetWidth - 8)
        const maxY = Math.max(0, window.innerHeight - root.offsetHeight - 8)
        const x = Math.min(maxX, Math.max(MIN_LEFT, event.clientX - drag.offsetX))
        const y = Math.min(maxY, Math.max(MIN_TOP, event.clientY - drag.offsetY))
        drag.x = x
        drag.y = y
        posRef.current = { x, y }
        setPos({ x, y })
      }, [])

      const endDrag = useCallback((event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        dragRef.current = null
        setDragging(false)
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {}
        if (drag.moved) {
          suppressClick.current = Date.now()
          savePos({ x: drag.x, y: drag.y })
        }
      }, [])

      const startDeckDrag = useCallback((event) => {
        const target = event.target
        if (target && typeof target.closest === 'function' && target.closest('button')) return
        startDrag(event)
      }, [startDrag])

      const load = useCallback(async (force, manual) => {
        if (manual) setRefreshing(true)
        try {
          const next = await request('/state' + (force ? '?force=1' : ''), undefined, t)
          setData(next)
          setLoadError('')
        } catch (error) {
          setLoadError(String((error && error.message) || error))
        } finally {
          if (manual) setRefreshing(false)
          setLoading(false)
        }
      }, [t])

      useEffect(() => {
        load(false, false)
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') load(false, false)
        }, 120000)
        const onVisible = () => {
          if (document.visibilityState === 'visible') load(false, false)
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      useEffect(() => {
        if (loading || !data) return
        if (data.accounts.length === 0) {
          openDeck()
          setAdding(true)
        }
      }, [loading, data, openDeck])

      useEffect(() => {
        const onResize = () => {
          setPos((current) => {
            if (!current) return current
            const root = rootRef.current
            if (!root) return current
            const maxX = Math.max(0, window.innerWidth - root.offsetWidth - 8)
            const maxY = Math.max(0, window.innerHeight - root.offsetHeight - 8)
            const x = Math.min(maxX, Math.max(MIN_LEFT, current.x))
            const y = Math.min(maxY, Math.max(MIN_TOP, current.y))
            if (x === current.x && y === current.y) return current
            const next = { x, y }
            posRef.current = next
            savePos(next)
            return next
          })
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      const activateAccount = useCallback(async (id) => {
        const now = Date.now()
        // A short lock instead of a boolean ref: a failed/hung request can
        // never block switching forever.
        if (now - lastSwitchAt.current < 1500) return
        const accounts = (dataRef.current && dataRef.current.accounts) || []
        const target = accounts.find((account) => account.id === id)
        if (!target) {
          setActionError(t.noAccount || t.fallbackError)
          return
        }
        if (unusable(target)) {
          setActionError(t.unusable)
          return
        }
        lastSwitchAt.current = now
        setSwitching(id)
        setActionError('')
        let timer = null
        try {
          const next = await Promise.race([
            request('/activate', { id }, t),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(t.switchTimeout || 'timeout')), 20000)
            }),
          ])
          setData(next)
          // dsh-cost-meter renders the active Go quota at the bottom-left and
          // re-reads its state on visibilitychange. Nudge it so the panel shows
          // the newly selected key immediately instead of on its 60s poll.
          try {
            document.dispatchEvent(new Event('visibilitychange'))
          } catch {}
        } catch (error) {
          setActionError(String((error && error.message) || error))
        } finally {
          if (timer !== null) clearTimeout(timer)
          setSwitching('')
        }
      }, [t])

      const addAccount = useCallback(async (name, key) => {
        setBusy(true)
        setActionError('')
        try {
          const next = await request('/accounts', { name, key }, t)
          setData(next)
          setAdding(false)
        } finally {
          setBusy(false)
        }
      }, [t])

      const removeAccount = useCallback(async (id) => {
        setBusy(true)
        setActionError('')
        try {
          const next = await request('/accounts/remove', { id }, t)
          setData(next)
          try {
            document.dispatchEvent(new Event('visibilitychange'))
          } catch {}
        } catch (error) {
          setActionError(String((error && error.message) || error))
        } finally {
          setBusy(false)
        }
      }, [t])

      const accounts = (data && data.accounts) || []
      const effectiveActiveId = (data && data.activeId) || null
      const active = accounts.find((account) => account.id === effectiveActiveId) || null
      const rest = accounts
        .filter((account) => account.id !== (active && active.id))
        .sort((a, b) => (starredIds.has(b.id) ? 1 : 0) - (starredIds.has(a.id) ? 1 : 0))
      const autoColumns = rest.length >= 2
      const columns = manualCols === 1 ? false : manualCols === 2 ? true : autoColumns
      const panelWidth = columns ? 460 : 280

      const prevColumns = useRef(columns)
      useEffect(() => {
        if (prevColumns.current === columns) return
        prevColumns.current = columns
        setLayoutEpoch((value) => value + 1)
      }, [columns])

      const clampToViewport = useCallback(() => {
        const current = posRef.current
        const root = rootRef.current
        if (!current || !root) return
        const maxX = Math.max(0, window.innerWidth - root.offsetWidth - 8)
        const maxY = Math.max(0, window.innerHeight - root.offsetHeight - 8)
        const x = Math.min(maxX, Math.max(MIN_LEFT, current.x))
        const y = Math.min(maxY, Math.max(MIN_TOP, current.y))
        if (x === current.x && y === current.y) return
        const next = { x, y }
        posRef.current = next
        setPos(next)
        savePos(next)
      }, [])

      useEffect(() => {
        const root = rootRef.current
        if (!root) return
        clampToViewport()
        if (typeof ResizeObserver !== 'function') return
        const observer = new ResizeObserver(() => clampToViewport())
        observer.observe(root)
        return () => observer.disconnect()
      }, [clampToViewport])

      const cycleLayout = useCallback(() => {
        const current = manualCols === null ? (autoColumns ? 2 : 1) : manualCols
        const next = current === 2 ? 1 : 2
        setManualCols(next)
        storeCols(next)
      }, [manualCols, autoColumns])

      const layoutLabel = manualCols === 1 ? t.layoutOne : manualCols === 2 ? t.layoutTwo : t.layoutAuto

      let overall = null
      for (const account of accounts) {
        const value = worstOf(account)
        if (value === null) continue
        overall = overall === null ? value : Math.max(overall, value)
      }
      const tone = overall === null ? 'idle' : toneOf(overall)
      const stamp = data && data.at ? formatStamp(data.at, zh) : ''
      const message = actionError || loadError

      const styleTag = h('style', { key: 'goq-style' }, CSS)
      const rootProps = {
        ref: rootRef,
        className: 'goq-root' + (dragging ? ' is-dragging' : ''),
        style: pos ? { left: pos.x, top: pos.y, right: 'auto' } : undefined,
      }

      if (!panelMounted) {
        return h('div', rootProps, styleTag,
          h(Pill, {
            account: active,
            count: accounts.length,
            t,
            dragging,
            onOpen: () => {
              if (Date.now() - suppressClick.current < 400) return
              openDeck()
            },
            onDragStart: startDrag,
            onDragMove: moveDrag,
            onDragEnd: endDrag,
          }))
      }

      return h('div', rootProps, styleTag,
        h('div', {
          className: 'goq-panel' + (closing ? ' is-closing' : ''),
          style: {
            width: panelWidth,
            transformOrigin: pos ? 'top left' : 'top right',
          },
        },
          h('div', {
            className: 'goq-head',
            onPointerDown: startDeckDrag,
            onPointerMove: moveDrag,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
          },
            h('span', { className: 'goq-dot goq-tone-' + tone }),
            h('span', { className: 'goq-title', title: t.dragDeck }, t.title),
            h('span', { className: 'goq-count' },
              accounts.length > 0 ? t.count(accounts.length) : (loading ? t.loading : '')),
            h('span', { className: 'goq-spacer' }),
            h('button', {
              type: 'button',
              className: 'goq-iconbtn goq-layout',
              title: t.layoutHint + ' · ' + layoutLabel,
              'aria-label': t.layoutHint + ' · ' + layoutLabel,
              onClick: cycleLayout,
            }, h(LayoutIcon, { key: columns ? 'two' : 'one', columns })),
            h('button', {
              type: 'button',
              className: 'goq-iconbtn',
              title: t.refresh,
              'aria-label': t.refresh,
              disabled: refreshing,
              onClick: () => load(true, true),
            }, h(RefreshIcon, { spin: refreshing })),
            h('button', {
              type: 'button',
              className: 'goq-iconbtn',
              title: t.collapse,
              'aria-label': t.collapse,
              onClick: closeDeck,
            }, h(ChevronIcon))),

          message ? h('div', { className: 'goq-banner', role: 'alert' }, message) : null,

          h('div', { className: 'goq-body' },
            active ? h(ActiveBar, {
              key: active.id + ':' + layoutEpoch,
              account: active,
              zh,
              t,
              switching: switching === active.id,
              starred: starredIds.has(active.id),
              onStar: toggleStar,
            }) : null,
            rest.map((account, index) => h(QuotaCard, {
              key: account.id + ':' + layoutEpoch,
              account,
              index,
              zh,
              t,
              switching: switching === account.id,
              starred: starredIds.has(account.id),
              onStar: toggleStar,
              onActivate: activateAccount,
              onDelete: removeAccount,
            })),
            accounts.length === 0 && !loading && !adding
              ? h('div', { className: 'goq-empty' },
                  h('span', { className: 'goq-empty-title' }, t.emptyTitle),
                  h('span', null, t.emptyHint))
              : null,
            loading && !data
              ? h('div', { className: 'goq-empty' }, t.loading)
              : null,
            adding
              ? h(AddForm, { t, busy, onAdd: addAccount, onCancel: () => setAdding(false) })
              : null),

          h('div', { className: 'goq-foot' },
            h('button', {
              type: 'button',
              className: 'goq-add',
              onClick: () => setAdding((value) => !value),
            }, adding ? t.cancel : '+ ' + t.add),
            h('span', { className: 'goq-stamp' }, stamp ? t.updated(stamp) : ''))))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        clientCtx = ctx
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'go-quota',
          order: 60,
        }, GoQuotaDeck))
      },
    }
  },
})
