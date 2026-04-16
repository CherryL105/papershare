const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/catalog-runtime-B9RaP4Ge.js","assets/client-store-Cmp0iwXE.js"])))=>i.map(i=>d[i]);
import{B as e,G as t,U as n,V as r,_ as i,_t as a,g as o,gt as s,h as c,ht as l,mt as u,q as d,vt as f,w as p}from"./client-store-Cmp0iwXE.js";import{n as m,r as h,t as g}from"./AuthGate-BOJ_YgIV.js";var _=`<section id="profile-view" class="profile-grid is-hidden">
  <section class="panel profile-overview">
    <div class="panel-header">
      <h3>个人信息</h3>
      <span id="profile-stats" class="status-pill">加载中...</span>
    </div>
    <div id="profile-summary" class="profile-summary empty-state">
      登录后可查看你的账号信息。
    </div>
    <div class="profile-action-stack">
      <p class="panel-tip">在账号设置里可以修改你的用户名和登录密码。</p>
      <div class="profile-action-row">
        <button id="account-settings-button" class="primary-button" type="button">
          账号设置
        </button>
        <button
          id="user-management-button"
          class="ghost-button is-hidden"
          type="button"
        >
          用户管理
        </button>
      </div>
    </div>
  </section>

  <section class="panel profile-annotations-panel">
    <div class="panel-header">
      <div id="profile-panel-tabs" class="profile-panel-tabs" role="tablist" aria-label="我的内容分类">
        <button
          id="profile-panel-papers-button"
          class="profile-panel-tab active"
          type="button"
          role="tab"
          aria-selected="true"
        >
          我上传的文章
          <span id="my-paper-count" class="annotation-count">0 篇</span>
        </button>
        <button
          id="profile-panel-speeches-button"
          class="profile-panel-tab"
          type="button"
          role="tab"
          aria-selected="false"
        >
          我的发言
          <span id="my-annotation-count" class="annotation-count">0 条</span>
        </button>
        <button
          id="profile-panel-replies-button"
          class="profile-panel-tab"
          type="button"
          role="tab"
          aria-selected="false"
        >
          别人回复我
          <span id="received-reply-count" class="annotation-count">0 条</span>
        </button>
      </div>
    </div>

    <section
      id="profile-panel-papers"
      class="profile-panel-view"
      role="tabpanel"
      aria-labelledby="profile-panel-papers-button"
    >
      <p class="panel-tip">按文章上传时间排序，点击“详情”可跳转到对应文章及批注。</p>
      <div id="my-paper-list" class="annotation-list empty-state">
        你还没有上传自己的文章。
      </div>
    </section>

    <section
      id="profile-panel-speeches"
      class="profile-panel-view is-hidden"
      role="tabpanel"
      aria-labelledby="profile-panel-speeches-button"
    >
      <p class="panel-tip">按最新发言时间排序，点击“详情”可跳转到对应文章和发言。</p>
      <div id="my-annotation-list" class="annotation-list empty-state">
        你还没有创建自己的发言。
      </div>
    </section>

    <section
      id="profile-panel-replies"
      class="profile-panel-view is-hidden"
      role="tabpanel"
      aria-labelledby="profile-panel-replies-button"
    >
      <p class="panel-tip">按最新回复时间排序，点击“详情”可跳转到对应文章和这条回复。</p>
      <div id="received-reply-list" class="annotation-list empty-state">
        目前还没有人回复你。
      </div>
    </section>
  </section>
</section>

<section id="password-view" class="account-view is-hidden">
  <section class="panel account-panel">
    <div class="panel-header panel-header-actions">
      <h3>账号设置</h3>
      <button id="password-back-button" class="ghost-button" type="button">
        返回
      </button>
    </div>
    <div class="account-settings-stack">
      <section class="account-setting-group">
        <div class="panel-header">
          <h4>修改用户名</h4>
        </div>
        <p class="panel-tip">修改后，历史上传和发言中的显示名会同步更新。</p>
        <span id="username-status" class="status-pill">请输入新的用户名</span>
        <form id="username-form" class="paper-form">
          <label class="field">
            <span>当前用户名</span>
            <input id="current-username" type="text" readonly />
          </label>

          <label class="field">
            <span>新用户名</span>
            <input
              id="next-username"
              name="username"
              type="text"
              autocomplete="username"
              required
            />
          </label>

          <button id="change-username-button" class="primary-button" type="submit">
            更新用户名
          </button>
        </form>
      </section>

      <section class="account-setting-group">
        <div class="panel-header">
          <h4>修改密码</h4>
        </div>
        <span id="password-status" class="status-pill">请输入当前密码和新密码</span>
        <form id="password-form" class="paper-form">
          <label class="field">
            <span>当前密码</span>
            <input
              id="current-password"
              name="currentPassword"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>

          <label class="field">
            <span>新密码</span>
            <input
              id="next-password"
              name="nextPassword"
              type="password"
              autocomplete="new-password"
              required
            />
          </label>

          <label class="field">
            <span>确认新密码</span>
            <input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autocomplete="new-password"
              required
            />
          </label>

          <button id="change-password-button" class="primary-button" type="submit">
            更新密码
          </button>
        </form>
      </section>
    </div>
  </section>
</section>

<section id="user-management-view" class="account-view is-hidden">
  <section class="panel account-panel">
    <div class="panel-header panel-header-actions">
      <h3>用户管理</h3>
      <button id="user-management-back-button" class="ghost-button" type="button">
        返回
      </button>
    </div>
    <div class="account-settings-stack">
      <section class="account-setting-group">
        <div class="panel-header">
          <h4>创建普通用户</h4>
        </div>
        <p class="panel-tip">新建用户默认为普通成员，可立刻使用用户名和初始密码登录。</p>
        <span id="user-management-status" class="status-pill">
          管理员可以创建新的普通用户
        </span>
        <form id="create-user-form" class="paper-form">
          <label class="field">
            <span>用户名</span>
            <input
              id="create-user-username"
              name="username"
              type="text"
              autocomplete="off"
              required
            />
          </label>

          <label class="field">
            <span>初始密码</span>
            <input
              id="create-user-password"
              name="password"
              type="password"
              autocomplete="new-password"
              required
            />
          </label>

          <label class="field">
            <span>确认初始密码</span>
            <input
              id="create-user-confirm-password"
              name="confirmPassword"
              type="password"
              autocomplete="new-password"
              required
            />
          </label>

          <button id="create-user-button" class="primary-button" type="submit">
            创建普通用户
          </button>
        </form>
      </section>

      <section class="account-setting-group">
        <div class="panel-header">
          <h4>现有用户</h4>
          <span id="managed-user-count" class="status-pill">0 人</span>
        </div>
        <div id="managed-user-list" class="annotation-list empty-state">
          暂无用户数据。
        </div>
      </section>
    </div>
  </section>
</section>

<section id="members-view" class="profile-grid is-hidden">
  <section class="panel">
    <div class="panel-header">
      <h3>课题组成员</h3>
      <span id="member-count" class="status-pill">0 人</span>
    </div>
    <p class="panel-tip">这里展示除你之外的其他成员，点击任意成员即可查看其上传的文章和发言。</p>
    <div id="member-list" class="paper-list empty-state">
      暂无其他成员。
    </div>
  </section>

  <section class="panel profile-annotations-panel">
    <div class="panel-header">
      <div class="profile-panel-tabs" role="tablist" aria-label="成员内容分类">
        <button
          id="member-profile-papers-button"
          class="profile-panel-tab active"
          type="button"
          role="tab"
          aria-selected="true"
        >
          TA 上传的文章
          <span id="member-profile-paper-count" class="annotation-count">0 篇</span>
        </button>
        <button
          id="member-profile-speeches-button"
          class="profile-panel-tab"
          type="button"
          role="tab"
          aria-selected="false"
        >
          TA 的发言
          <span id="member-profile-annotation-count" class="annotation-count">0 条</span>
        </button>
      </div>
    </div>

    <section
      id="member-profile-papers"
      class="profile-panel-view"
      role="tabpanel"
      aria-labelledby="member-profile-papers-button"
    >
      <p class="panel-tip">按文章上传时间排序，点击“详情”可跳转到对应文章。</p>
      <div id="member-profile-paper-list" class="annotation-list empty-state">
        请选择一位成员。
      </div>
    </section>

    <section
      id="member-profile-speeches"
      class="profile-panel-view is-hidden"
      role="tabpanel"
      aria-labelledby="member-profile-speeches-button"
    >
      <p class="panel-tip">按最新发言时间排序，点击“详情”可跳转到对应文章和发言。</p>
      <div id="member-profile-annotation-list" class="annotation-list empty-state">
        请选择一位成员。
      </div>
    </section>
  </section>
</section>
`,v=`/home/dictation/papershare/src/client/catalog/CatalogLibraryView.jsx`;function y(){let e=d();return h(`section`,{id:`library-view`,className:`content-grid is-catalog`,children:[h(b,{snapshot:e},void 0,!1,{fileName:v,lineNumber:19,columnNumber:7},this),h(`button`,{className:`pane-resizer`,type:`button`,"data-resizer":`left`,"aria-label":`调整左侧栏宽度`,"aria-orientation":`vertical`},void 0,!1,{fileName:v,lineNumber:21,columnNumber:7},this),h(x,{snapshot:e},void 0,!1,{fileName:v,lineNumber:29,columnNumber:7},this)]},void 0,!0,{fileName:v,lineNumber:18,columnNumber:5},this)}function b({snapshot:r}){let i=u(null),[a,c]=l(``),[d,f]=l(``);s(()=>{r.auth.currentUser||(c(``),f(``))},[r.auth.currentUser]);let m=!!a.trim(),g=!r.auth.serverReady||!r.auth.currentUser||r.catalog.isSavingPaper;async function _(e){if(e.preventDefault(),a.trim())try{let e=await t({sourceUrl:a,rawHtml:d});c(``),f(``),p(e.id)}catch(e){let t=o().catalog.paperFormStatus;if(!d.trim()&&n(e.message||t)){i.current?.focus(),window.alert([e.message||`抓取失败`,``,`请点击“在浏览器打开文章网址”，在你自己的浏览器完成验证后，右键“查看页面源代码”，将 HTML 源码复制粘贴到输入框后再上传。`,`如果文章来自 ScienceDirect，系统会自动尝试使用内置 Elsevier API 抓取全文 XML。`].join(`
`));return}window.alert(t||e.message||`抓取失败`)}}function y(){if(!a.trim()){e(`请先填写文献网址`);return}let t=``;try{t=new URL(a).toString()}catch{e(`请输入有效的网址`);return}let n=window.open(t,`_blank`);if(n){try{n.opener=null,n.focus?.()}catch{}e(`已在你的浏览器打开原文。完成验证并进入论文正文后，请把“查看页面源代码”的 HTML 粘贴到上方，再点“抓取并保存”。`);return}i.current?.focus(),e(`浏览器拦截了新窗口，请允许弹窗后重试，或手动打开该网址并把页面源代码粘贴到上方。`)}return h(`aside`,{className:`library-sidebar`,children:h(`section`,{className:`panel`,children:[h(`div`,{className:`panel-header`,children:[h(`h2`,{children:`上传新文章`},void 0,!1,{fileName:v,lineNumber:123,columnNumber:11},this),h(`span`,{id:`paper-form-status`,className:`status-pill`,children:r.catalog.paperFormStatus},void 0,!1,{fileName:v,lineNumber:124,columnNumber:11},this)]},void 0,!0,{fileName:v,lineNumber:122,columnNumber:9},this),h(`form`,{id:`paper-form`,className:`paper-form`,onSubmit:_,children:[h(`label`,{className:`field`,children:[h(`span`,{children:`（必填）文章网址`},void 0,!1,{fileName:v,lineNumber:131,columnNumber:13},this),h(`input`,{id:`paper-source-url`,name:`sourceUrl`,type:`url`,placeholder:`https://example.org/paper`,value:a,onInput:e=>c(e.currentTarget.value),required:!0},void 0,!1,{fileName:v,lineNumber:132,columnNumber:13},this)]},void 0,!0,{fileName:v,lineNumber:130,columnNumber:11},this),h(`p`,{className:`panel-tip`,children:`开放获取的文章只需输入网址就可以直接抓取，如Nature系列、EGU系列。`},void 0,!1,{fileName:v,lineNumber:143,columnNumber:11},this),h(`p`,{className:`panel-tip`,children:`Elsevier系列：如果管理员配置了API密钥，则用户只需输入网址，系统通过API获取。`},void 0,!1,{fileName:v,lineNumber:147,columnNumber:11},this),h(`label`,{className:`field`,children:[h(`span`,{children:`（选填）Wiley等需要登录或人机验证的文章，请额外将页面源代码粘贴到下方输入框里。`},void 0,!1,{fileName:v,lineNumber:152,columnNumber:13},this),h(`textarea`,{id:`paper-raw-html`,ref:i,name:`rawHtml`,rows:`5`,placeholder:`遇到 Wiley 等需要人机验证的网站时，先在浏览器打开文章网址并完成登录验证，在网页右键，点击“查看页面源代码”，ctrl+A全选，ctrl+C复制。ctrl+V粘贴到这里。`,value:d,onInput:e=>f(e.currentTarget.value)},void 0,!1,{fileName:v,lineNumber:153,columnNumber:13},this)]},void 0,!0,{fileName:v,lineNumber:151,columnNumber:11},this),h(`div`,{className:`browser-fetch-actions`,children:h(`button`,{id:`open-source-url-button`,className:`primary-button`,type:`button`,onClick:y,disabled:!m||r.catalog.isSavingPaper,children:`在浏览器打开文章网址`},void 0,!1,{fileName:v,lineNumber:165,columnNumber:13},this)},void 0,!1,{fileName:v,lineNumber:164,columnNumber:11},this),h(`button`,{id:`save-paper-button`,className:`primary-button`,type:`submit`,disabled:g,children:`抓取并上传`},void 0,!1,{fileName:v,lineNumber:176,columnNumber:11},this)]},void 0,!0,{fileName:v,lineNumber:129,columnNumber:9},this)]},void 0,!0,{fileName:v,lineNumber:121,columnNumber:7},this)},void 0,!1,{fileName:v,lineNumber:120,columnNumber:5},this)}function x({snapshot:e}){let t=e.papers.items,n=i(t,e.catalog.searchTerm);return h(`section`,{className:`library-search`,children:h(`section`,{className:`panel`,children:[h(`div`,{className:`panel-header`,children:[h(`h2`,{children:`文章和讨论列表`},void 0,!1,{fileName:v,lineNumber:198,columnNumber:11},this),h(`span`,{id:`paper-count`,className:`annotation-count`,children:`${n.length} / ${t.length} 篇`},void 0,!1,{fileName:v,lineNumber:199,columnNumber:11},this)]},void 0,!0,{fileName:v,lineNumber:197,columnNumber:9},this),h(`p`,{className:`panel-tip`,children:`文献条目按活动时间最近排序。点击文献条目可进入新的阅读与批注页面。`},void 0,!1,{fileName:v,lineNumber:204,columnNumber:9},this),h(`label`,{className:`field`,children:h(`input`,{id:`paper-search-input`,className:`search-input`,type:`search`,placeholder:`按标题、作者、摘要、关键词、上传人搜索`,value:e.catalog.searchTerm,onInput:e=>r(e.currentTarget.value)},void 0,!1,{fileName:v,lineNumber:207,columnNumber:11},this)},void 0,!1,{fileName:v,lineNumber:206,columnNumber:9},this),t.length?n.length?h(`div`,{id:`paper-list`,className:`paper-list`,children:n.map(e=>h(S,{paper:e},e.id,!1,{fileName:v,lineNumber:228,columnNumber:15},this))},void 0,!1,{fileName:v,lineNumber:226,columnNumber:11},this):h(`div`,{id:`paper-list`,className:`paper-list empty-state`,children:`没有匹配的文献，请换个关键词试试。`},void 0,!1,{fileName:v,lineNumber:222,columnNumber:11},this):h(`div`,{id:`paper-list`,className:`paper-list empty-state`,children:`storage 文件夹中还没有文献。`},void 0,!1,{fileName:v,lineNumber:218,columnNumber:11},this)]},void 0,!0,{fileName:v,lineNumber:196,columnNumber:7},this)},void 0,!1,{fileName:v,lineNumber:195,columnNumber:5},this)}function S({paper:e}){let t=e.created_by_username?`上传者：${e.created_by_username}`:`上传者未知`,n=e.latestSpeakerUsername||`暂无`,r=e.latestSpeechAt?c(e.latestSpeechAt):`暂无`,i=c(e.createdAt||e.created_at);return h(`button`,{className:`paper-item`,type:`button`,"data-paper-id":e.id,onClick:()=>p(e.id),children:[h(`strong`,{children:C(e.title||`未命名文献`,90)},void 0,!1,{fileName:v,lineNumber:250,columnNumber:7},this),h(`span`,{children:C(e.authors||`未填写作者`,90)},void 0,!1,{fileName:v,lineNumber:251,columnNumber:7},this),h(`span`,{className:`paper-item-journal`,children:C(e.journal||`未填写来源`,90)},void 0,!1,{fileName:v,lineNumber:252,columnNumber:7},this),h(`span`,{children:t},void 0,!1,{fileName:v,lineNumber:253,columnNumber:7},this),h(`span`,{className:`paper-item-speech-meta`,children:[`发言 `,e.speech_count||0,` 条 · 最近 `,n,` · `,r]},void 0,!0,{fileName:v,lineNumber:254,columnNumber:7},this),h(`span`,{className:`paper-item-uploaded-at`,children:[`上传于 `,i]},void 0,!0,{fileName:v,lineNumber:257,columnNumber:7},this)]},void 0,!0,{fileName:v,lineNumber:244,columnNumber:5},this)}function C(e,t){let n=String(e||``);return n.length<=t?n:`${n.slice(0,t)}...`}var w=`/home/dictation/papershare/src/client/shared/raw-markup.jsx`;function T({html:e}){return h(`div`,{style:{display:`contents`},dangerouslySetInnerHTML:{__html:e}},void 0,!1,{fileName:w,lineNumber:2,columnNumber:10},this)}var E=`/home/dictation/papershare/src/client/catalog/CatalogPage.jsx`;function D(){return h(f,{children:[h(m,{showViewSwitcher:!0},void 0,!1,{fileName:E,lineNumber:10,columnNumber:7},this),h(`div`,{className:`page-shell`,children:[h(g,{},void 0,!1,{fileName:E,lineNumber:12,columnNumber:9},this),h(`main`,{id:`app-content`,className:`app-content is-hidden`,children:[h(y,{},void 0,!1,{fileName:E,lineNumber:14,columnNumber:11},this),h(T,{html:_},void 0,!1,{fileName:E,lineNumber:15,columnNumber:11},this)]},void 0,!0,{fileName:E,lineNumber:13,columnNumber:9},this)]},void 0,!0,{fileName:E,lineNumber:11,columnNumber:7},this)]},void 0,!0)}var O=`modulepreload`,k=function(e){return`/`+e},A={},j=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}r=o(t.map(t=>{if(t=k(t,n),t in A)return;A[t]=!0;let r=t.endsWith(`.css`),i=r?`[rel="stylesheet"]`:``;if(n)for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}else if(document.querySelector(`link[href="${t}"]${i}`))return;let o=document.createElement(`link`);if(o.rel=r?`stylesheet`:O,r||(o.as=`script`),o.crossOrigin=``,o.href=t,a&&o.setAttribute(`nonce`,a),document.head.appendChild(o),r)return new Promise((e,n)=>{o.addEventListener(`load`,e),o.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})};async function M(){(document.body?.dataset?.page||`catalog`)===`catalog`&&(await j(()=>import(`./catalog-runtime-B9RaP4Ge.js`),__vite__mapDeps([0,1]))).bootCatalogLegacyRuntime()}var N=`/home/dictation/papershare/src/client/catalog/main.jsx`,P=document.getElementById(`app`);if(!P)throw Error(`Catalog root container was not found.`);a(h(D,{},void 0,!1,{fileName:N,lineNumber:11,columnNumber:8},void 0),P),M();