// sidebar-v2 externalized (NAV-2) — hub-aware active highlight
(function(){
  var dp=document.body.getAttribute('data-page')||document.documentElement.getAttribute('data-page')||'';
  var links=document.querySelectorAll('#mainSidebar .qc-nav-item');
  var matched=null;
  links.forEach(function(a){ var pages=(a.getAttribute('data-pages')||'').split(',').map(function(s){return s.trim()}); if(pages.includes(dp)||a.getAttribute('data-page')===dp) matched=a; });
  if(matched){ matched.classList.add('active'); var sm=matched.closest('.qc-nav-submenu'); if(sm){ sm.classList.add('open'); var sec=sm.getAttribute('data-submenu'); var btn=document.querySelector('[data-section="'+sec+'"]'); if(btn) btn.setAttribute('aria-expanded','true'); } }
    try{ if(localStorage.getItem('sidebarCollapsed')==='1'){ document.body.classList.add('sidebar-collapsed'); var sb=document.getElementById('mainSidebar'); if(sb) sb.classList.add('collapsed'); } }catch(e){}
  var tog=document.getElementById('sidebarToggleBtn'); if(tog){ tog.addEventListener('click', function(){ var sb=document.getElementById('mainSidebar'); if(!sb) return; var c=sb.classList.toggle('collapsed'); document.body.classList.toggle('sidebar-collapsed', c); try{ localStorage.setItem('sidebarCollapsed', c?'1':'0'); }catch(e){} }); }
  document.querySelectorAll('.qc-nav-section-toggle').forEach(function(btn){ btn.addEventListener('click',function(){ var sec=btn.getAttribute('data-section'); var sm=document.querySelector('[data-submenu="'+sec+'"]'); if(!sm) return; var open=sm.classList.contains('open'); sm.classList.toggle('open',!open); btn.setAttribute('aria-expanded',String(!open)); }); });
})();
