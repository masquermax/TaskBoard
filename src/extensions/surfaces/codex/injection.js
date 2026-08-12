import { APP_VERSION } from '../../../version.js';

export const CODEX_SURFACE_STYLE = '#taskboard-host-page{position:absolute;inset:0;z-index:80;background:#f5f6f8;color:#1f2328;overflow:hidden;}#taskboard-host-page[hidden]{display:none!important;}#taskboard-host-frame{width:100%;height:100%;border:0;display:block;background:#f5f6f8;}#taskboard-host-entry[aria-current=\"page\"]{background:color-mix(in srgb,currentColor 8%,transparent);}';

export function localTaskboardUrl(value) {
  const url = new URL(value || 'http://127.0.0.1:4317');
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','::1'].includes(url.hostname)) throw new Error('CDP surface only accepts a loopback TaskBoard URL');
  return url.toString();
}

export function buildCodexSurfaceInjection({ taskboardUrl }) {
  const baseUrl = localTaskboardUrl(taskboardUrl);
  const config = JSON.stringify({ baseUrl, source:`taskboard-v${APP_VERSION}-blob-bridge`, style:CODEX_SURFACE_STYLE });
  return `(() => {
    try {
      const cfg=${config};
      const KEY='__taskboardSurfaceV1';
      const ENTRY='taskboard-host-entry';
      const PAGE='taskboard-host-page';
      const FRAME='taskboard-host-frame';
      const STYLE='taskboard-host-style';
      const previous=window[KEY];
      if(previous&&previous.source===cfg.source){ previous.refresh?.(); return {ok:true,reused:true,frameUrl:document.getElementById(FRAME)?.src||null,surfaceKind:'blob-bridge'}; }
      try{ previous?.destroy?.(); }catch{}
      let active=false,observer=null,frameReady=false,blobUrl=null;
      const norm=v=>String(v||'').replace(/\\s+/g,' ').trim().toLowerCase();
      function installStyle(){
        if(document.getElementById(STYLE))return;
        const s=document.createElement('style');s.id=STYLE;s.textContent=cfg.style;
        (document.head||document.documentElement).appendChild(s);
      }
      function sidebar(){return document.querySelector('[data-app-action-sidebar-scroll]')||document.querySelector('aside nav[role="navigation"]')||document.querySelector('aside');}
      function referenceButton(){
        const root=sidebar();if(!root)return null;
        const buttons=[...root.querySelectorAll('button')];
        return buttons.find(b=>['plugins','插件'].includes(norm(b.textContent||b.getAttribute('aria-label'))))||buttons.find(b=>b.getBoundingClientRect().height>20)||null;
      }
      function mount(){return document.querySelector('.app-shell-main-content-frame')||document.querySelector('[data-app-shell-main-content-layout]')||document.querySelector('main');}
      function makeBlobUrl(){
        const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TaskBoard</title></head><body style="margin:0;background:#f5f6f8;font-family:Segoe UI,Microsoft YaHei,sans-serif"><div id="taskboard-bridge-boot" style="min-height:100vh;display:grid;place-items:center;color:#667085;font-size:14px">TaskBoard 正在载入…</div></body></html>';
        return URL.createObjectURL(new Blob([html],{type:'text/html'}));
      }
      function onFrameMessage(event){
        const f=document.getElementById(FRAME);
        if(!f||event.source!==f.contentWindow)return;
        const message=event.data;
        if(!message||message.type!=='taskboard:ready'||message.host!=='codex')return;
        frameReady=true;f.dataset.taskboardReady='true';
      }
      window.addEventListener('message',onFrameMessage);
      function createFrame(){
        const old=document.getElementById(FRAME);if(old)old.remove();if(blobUrl)try{URL.revokeObjectURL(blobUrl);}catch{}
        const frame=document.createElement('iframe');frame.id=FRAME;frame.name='taskboard-surface';frameReady=false;blobUrl=makeBlobUrl();frame.src=blobUrl;frame.setAttribute('title','TaskBoard');frame.setAttribute('referrerpolicy','no-referrer');frame.setAttribute('allow','clipboard-read; clipboard-write');frame.dataset.taskboardSurfaceKind='blob-bridge';return frame;
      }
      function ensurePage(){
        const host=mount();if(!host)return null;installStyle();
        let page=document.getElementById(PAGE);
        if(!page){
          const pos=getComputedStyle(host).position;if(pos==='static')host.style.position='relative';
          page=document.createElement('section');page.id=PAGE;page.hidden=true;page.setAttribute('data-taskboard-owned','true');page.appendChild(createFrame());host.appendChild(page);
        }else{if(page.parentElement!==host)host.appendChild(page);if(!document.getElementById(FRAME))page.appendChild(createFrame());}
        return page;
      }
      function open(){const page=ensurePage();if(!page)return;active=true;page.hidden=false;const e=document.getElementById(ENTRY);e?.setAttribute('aria-current','page');}
      function close(){active=false;const page=document.getElementById(PAGE);if(page)page.hidden=true;document.getElementById(ENTRY)?.removeAttribute('aria-current');}
      function ensureEntry(){
        const ref=referenceButton();if(!ref?.parentElement)return null;
        let btn=document.getElementById(ENTRY);
        if(!btn){
          btn=ref.cloneNode(true);btn.id=ENTRY;btn.type='button';btn.removeAttribute('disabled');btn.removeAttribute('aria-expanded');btn.removeAttribute('aria-controls');
          btn.setAttribute('title','任务板');btn.setAttribute('aria-label','打开任务板');
          const text=[...btn.querySelectorAll('span')].find(x=>norm(x.textContent));if(text)text.textContent='任务板';else btn.textContent='任务板';
          const svg=btn.querySelector('svg');if(svg){svg.setAttribute('viewBox','0 0 24 24');svg.innerHTML='<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor"/><path d="M9 4v16M13 9h4M13 13h4M13 17h4" fill="none" stroke="currentColor" stroke-width="1.7"/>';}
          btn.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();open();});ref.after(btn);
        }
        if(active)btn.setAttribute('aria-current','page');return btn;
      }
      function refresh(){ensureEntry();ensurePage();}
      document.addEventListener('click',ev=>{if(!active)return;const t=ev.target;if(t?.closest?.('#'+ENTRY))return;if(t?.closest?.('aside nav, [data-app-action-sidebar-scroll]'))close();},true);
      observer=new MutationObserver(()=>{clearTimeout(window.__taskboardSurfaceTimer);window.__taskboardSurfaceTimer=setTimeout(refresh,120);});observer.observe(document.documentElement,{childList:true,subtree:true});
      refresh();
      window[KEY]={source:cfg.source,refresh,open,close,markReady(){const f=document.getElementById(FRAME);frameReady=true;if(f)f.dataset.taskboardReady='true';return true;},get frameReady(){return frameReady;},get frameUrl(){return document.getElementById(FRAME)?.src||blobUrl;},destroy(){observer?.disconnect();window.removeEventListener('message',onFrameMessage);document.getElementById(ENTRY)?.remove();document.getElementById(PAGE)?.remove();document.getElementById(STYLE)?.remove();if(blobUrl)try{URL.revokeObjectURL(blobUrl);}catch{}delete window[KEY];}};
      return {ok:true,reused:false,entry:Boolean(document.getElementById(ENTRY)),frameUrl:document.getElementById(FRAME)?.src||blobUrl,surfaceKind:'blob-bridge'};
    } catch(error) { return {ok:false,error:String(error?.message||error)}; }
  })()`;
}
