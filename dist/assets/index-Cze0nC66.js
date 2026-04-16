import{a as e,i as t,n,r,t as i}from"./legacy-runtime-DNoj55nR.js";import{n as a,t as o}from"./preact.module-CuVQW3e5.js";import{_ as s,c,d as l,f as u,g as d,h as f,i as p,n as m,p as h,r as g,u as _,v}from"./client-store-BiUmJWWm.js";var y=`<section id="profile-view" class="profile-grid is-hidden">
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
`;function b(){let t=f();return e(`section`,{id:`library-view`,className:`content-grid is-catalog`,children:[e(x,{snapshot:t}),e(`button`,{className:`pane-resizer`,type:`button`,"data-resizer":`left`,"aria-label":`调整左侧栏宽度`,"aria-orientation":`vertical`}),e(S,{snapshot:t})]})}function x({snapshot:t}){let n=d(null),[r,i]=s(``),[a,o]=s(``);v(()=>{t.auth.currentUser||(i(``),o(``))},[t.auth.currentUser]);let l=!!r.trim(),f=!t.auth.serverReady||!t.auth.currentUser||t.catalog.isSavingPaper;async function p(e){if(e.preventDefault(),r.trim())try{let e=await h({sourceUrl:r,rawHtml:a});i(``),o(``),c(e.id)}catch(e){let t=g().catalog.paperFormStatus;if(!a.trim()&&u(e.message||t)){n.current?.focus(),window.alert([e.message||`抓取失败`,``,`请点击“在浏览器打开文章网址”，在你自己的浏览器完成验证后，右键“查看页面源代码”，将 HTML 源码复制粘贴到输入框后再上传。`,`如果文章来自 ScienceDirect，系统会自动尝试使用内置 Elsevier API 抓取全文 XML。`].join(`
`));return}window.alert(t||e.message||`抓取失败`)}}function m(){if(!r.trim()){_(`请先填写文献网址`);return}let e=``;try{e=new URL(r).toString()}catch{_(`请输入有效的网址`);return}let t=window.open(e,`_blank`);if(t){try{t.opener=null,t.focus?.()}catch{}_(`已在你的浏览器打开原文。完成验证并进入论文正文后，请把“查看页面源代码”的 HTML 粘贴到上方，再点“抓取并保存”。`);return}n.current?.focus(),_(`浏览器拦截了新窗口，请允许弹窗后重试，或手动打开该网址并把页面源代码粘贴到上方。`)}return e(`aside`,{className:`library-sidebar`,children:e(`section`,{className:`panel`,children:[e(`div`,{className:`panel-header`,children:[e(`h2`,{children:`上传新文章`}),e(`span`,{id:`paper-form-status`,className:`status-pill`,children:t.catalog.paperFormStatus})]}),e(`form`,{id:`paper-form`,className:`paper-form`,onSubmit:p,children:[e(`label`,{className:`field`,children:[e(`span`,{children:`（必填）文章网址`}),e(`input`,{id:`paper-source-url`,name:`sourceUrl`,type:`url`,placeholder:`https://example.org/paper`,value:r,onInput:e=>i(e.currentTarget.value),required:!0})]}),e(`p`,{className:`panel-tip`,children:`开放获取的文章只需输入网址就可以直接抓取，如Nature系列、EGU系列。`}),e(`p`,{className:`panel-tip`,children:`Elsevier系列：如果管理员配置了API密钥，则用户只需输入网址，系统通过API获取。`}),e(`label`,{className:`field`,children:[e(`span`,{children:`（选填）Wiley等需要登录或人机验证的文章，请额外将页面源代码粘贴到下方输入框里。`}),e(`textarea`,{id:`paper-raw-html`,ref:n,name:`rawHtml`,rows:`5`,placeholder:`遇到 Wiley 等需要人机验证的网站时，先在浏览器打开文章网址并完成登录验证，在网页右键，点击“查看页面源代码”，ctrl+A全选，ctrl+C复制。ctrl+V粘贴到这里。`,value:a,onInput:e=>o(e.currentTarget.value)})]}),e(`div`,{className:`browser-fetch-actions`,children:e(`button`,{id:`open-source-url-button`,className:`primary-button`,type:`button`,onClick:m,disabled:!l||t.catalog.isSavingPaper,children:`在浏览器打开文章网址`})}),e(`button`,{id:`save-paper-button`,className:`primary-button`,type:`submit`,disabled:f,children:`抓取并上传`})]})]})})}function S({snapshot:t}){let n=t.papers.items,r=p(n,t.catalog.searchTerm);return e(`section`,{className:`library-search`,children:e(`section`,{className:`panel`,children:[e(`div`,{className:`panel-header`,children:[e(`h2`,{children:`文章和讨论列表`}),e(`span`,{id:`paper-count`,className:`annotation-count`,children:`${r.length} / ${n.length} 篇`})]}),e(`p`,{className:`panel-tip`,children:`文献条目按活动时间最近排序。点击文献条目可进入新的阅读与批注页面。`}),e(`label`,{className:`field`,children:e(`input`,{id:`paper-search-input`,className:`search-input`,type:`search`,placeholder:`按标题、作者、摘要、关键词、上传人搜索`,value:t.catalog.searchTerm,onInput:e=>l(e.currentTarget.value)})}),n.length?r.length?e(`div`,{id:`paper-list`,className:`paper-list`,children:r.map(t=>e(C,{paper:t},t.id))}):e(`div`,{id:`paper-list`,className:`paper-list empty-state`,children:`没有匹配的文献，请换个关键词试试。`}):e(`div`,{id:`paper-list`,className:`paper-list empty-state`,children:`storage 文件夹中还没有文献。`})]})})}function C({paper:t}){let n=t.created_by_username?`上传者：${t.created_by_username}`:`上传者未知`,r=t.latestSpeakerUsername||`暂无`,i=t.latestSpeechAt?m(t.latestSpeechAt):`暂无`,a=m(t.createdAt||t.created_at);return e(`button`,{className:`paper-item`,type:`button`,"data-paper-id":t.id,onClick:()=>c(t.id),children:[e(`strong`,{children:w(t.title||`未命名文献`,90)}),e(`span`,{children:w(t.authors||`未填写作者`,90)}),e(`span`,{className:`paper-item-journal`,children:w(t.journal||`未填写来源`,90)}),e(`span`,{children:n}),e(`span`,{className:`paper-item-speech-meta`,children:[`发言 `,t.speech_count||0,` 条 · 最近 `,r,` · `,i]}),e(`span`,{className:`paper-item-uploaded-at`,children:[`上传于 `,a]})]})}function w(e,t){let n=String(e||``);return n.length<=t?n:`${n.slice(0,t)}...`}function T(){return e(a,{children:[e(t,{showViewSwitcher:!0}),e(`div`,{className:`page-shell`,children:[e(r,{}),e(`main`,{id:`app-content`,className:`app-content is-hidden`,children:[e(b,{}),e(n,{html:y})]})]})]})}var E=document.getElementById(`app`);if(!E)throw Error(`Catalog root container was not found.`);o(e(T,{}),E),i();