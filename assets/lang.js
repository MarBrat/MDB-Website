// Language switch, same as the inline script of index.html (EN/DE, remembered in localStorage "lang").
(function(){var r=document.documentElement,l=null;
try{l=localStorage.getItem('lang')}catch(e){}
if(l!=='en'&&l!=='de'){l=((navigator.language||'').slice(0,2)==='de')?'de':'en'}
function show(x){r.classList.remove('en','de');r.classList.add('js',x);r.setAttribute('lang',x);
document.querySelectorAll('.lang button').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.l===x?'true':'false')})}
document.addEventListener('DOMContentLoaded',function(){
document.querySelectorAll('.lang button').forEach(function(b){b.addEventListener('click',function(){show(b.dataset.l);try{localStorage.setItem('lang',b.dataset.l)}catch(e){}})});show(l)});
r.classList.add('js',l)})();
