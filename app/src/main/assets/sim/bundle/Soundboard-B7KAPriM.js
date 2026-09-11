import{i as e}from"./rolldown-runtime-Dd_uD5pT.js";import{n as t,t as n}from"./jsx-runtime-BpzPEenQ.js";import{a as r,c as i,d as a,g as o,i as s,l as c,m as l,n as u,o as d,s as f,t as p,u as m,v as h}from"./audio-CLNDZ2Cm.js";var g=e(t(),1),_=44100,v=.3,y=(e=1,t=.05,n=220,r=0,i=0,a=.1,o=0,s=1,c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,y=1,b=0,x=0,S=0)=>{let C=Math,w=2*C.PI,T=_,E=c*=500*w/T/T,D=n*=(1-t+2*t*C.random(t=[]))*w/T,O=0,k=0,A=0,j=1,M=0,N=0,P=0,F=S<0?-1:1,I=w*F*S*2/T,L=C.cos(I),R=C.sin,z=R(I)/4,B=1+z,V=-2*L/B,H=(1-z)/B,U=(1+F*L)/2/B,W=-(F+L)/B,G=U,K=0,q=0,J=0,Y=0;for(r=T*r+9,b*=T,i*=T,a*=T,g*=T,l*=500*w/T**3,m*=w/T,u*=w/T,d*=T,f=T*f|0,e*=v,F=r+b+i+a+g|0;A<F;t[A++]=P*e)++N%(100*h|0)||(P=o?1<o?2<o?3<o?4<o?(O/w%1<s/2)*2-1:R(O**3):C.max(C.min(C.tan(O),1),-1):1-(2*O/w%2+2)%2:1-4*C.abs(C.round(O/w)-O/w):R(O),P=(f?1-x+x*R(w*A/f):1)*(4<o?P:(P<0?-1:1)*C.abs(P)**s)*(A<r?A/r:A<r+b?1-(A-r)/b*(1-y):A<r+b+i?y:A<F-g?(F-A-g)/a*y:0),P=g?P/2+(g>A?0:(A<F-g?1:(F-A)/g)*t[A-g|0]/2/e):P,S&&(P=Y=G*K+W*(K=q)+U*(q=P)-H*J-V*(J=Y))),I=(n+=c+=l)*C.cos(m*k++),O+=I+I*p*R(A**5),j&&++j>d&&(n+=u,D+=u,j=0),!f||++M%f||(n=D,c=E,j||=1);return t};function b(e,t,n){let r=e.createBuffer(1,n.length,_);r.getChannelData(0).set(n);let i=e.createBufferSource();return i.buffer=r,i.connect(t),i.start(),i}var x=(e,t,...n)=>b(e,t,y(...n)),S=n(),C={ambient:1,sfx:.9,voice:1},w={footstepTap:[1.4,.3,120,.001,.01,.05,4,1.9,-12,,,,,1.3,,.1,,.5,.02],footstepSoft:[1.1,.4,85,.001,.008,.04,4,2.2,-8,,,,,2,,.2,,.45,.015],ballThump:[2,.15,210,.002,.02,.16,0,2.4,-30,,,,,.3,,,,.8,.08],bodyBump:[1.7,.2,90,.002,.03,.19,0,2.9,-15,,,,,1,,.3,,.7,.11],uiClick:[.5,.2,1100,.001,.005,.02,1,1.4,,,,,,,,,,.6,.01],confirmBloop:[.7,0,523,.005,.12,.08,5,1,,,261,.07,,,,,,.8,.02],biosBeep:[.4,0,940,.004,.1,.05,5,1,,,,,,,,,,.9,.01],biosTick:[.25,.2,1850,.001,.004,.014,5,1,,,,,,,,,,.5,.005],scanBlip:[.35,.25,1900,.001,.01,.04,1,1,,,,,,,,,,.6,.01],entranceSweep:[1,0,150,.05,.5,.3,2,1,11,.4,,,,.35,,.15,,.8,.2]};async function T(e){let t=p();if(t.state===`suspended`)try{await t.resume()}catch{return}e()}var E=e=>x(p(),u(`sfx`),...e),D=`abcdefghijkl`;function O(){let[e,t]=(0,g.useState)(1),[n,_]=(0,g.useState)(!1),[v,y]=(0,g.useState)(!1),[b,x]=(0,g.useState)(!1),O=(0,g.useRef)(null),A=(0,g.useRef)(0);(0,g.useEffect)(()=>{p()},[]),(0,g.useEffect)(()=>{p();for(let[t,r]of Object.entries(C)){let i=t===`ambient`&&!n?0:e;u(t).gain.value=r*i}},[e,n]);let j=()=>T(()=>{_(e=>!e)}),M=()=>T(()=>{l(v?0:.7),y(e=>!e)}),N=()=>T(async()=>{let e=p(),t=O.current;if(t){if(O.current=null,x(!1),t.src){t.gain.gain.setTargetAtTime(0,e.currentTime,.05);try{t.src.stop(e.currentTime+.3)}catch{}}return}let n={};O.current=n,x(!0);let r;try{let t=await fetch(h(`./assets/voices/duck1/wheee_loop_a.wav`));r=await e.decodeAudioData(await t.arrayBuffer())}catch{O.current===n&&(O.current=null,x(!1));return}if(O.current!==n)return;let i=e.createGain();i.connect(u(`voice`));let a=e.currentTime+.02;i.gain.setValueAtTime(0,a),i.gain.linearRampToValueAtTime(.7,a+.02);let o=e.createBufferSource();o.buffer=r,o.loop=!0,o.connect(i),o.start(a),Object.assign(n,{src:o,gain:i})}),P=[{name:`Footstep`,cat:`sampled`,note:`step_a-e, random take, in-game gain/rate spread`,current:()=>m(`step`,{gain:.2,rate:.9+Math.random()*.25}),zz:[[`tap`,w.footstepTap],[`soft`,w.footstepSoft]]},{name:`Ball thump`,cat:`sampled`,note:`thump_a-c, mid-strength kick`,current:()=>m(`thump`,{gain:.34,rate:1.05+Math.random()*.08}),zz:[[`thump`,w.ballThump]]},{name:`Body bump`,cat:`sampled`,note:`thump takes pitched down to ~0.57`,current:()=>m(`thump`,{gain:.27,rate:.57+Math.random()*.06}),zz:[[`bump`,w.bodyBump]]},{name:`UI click`,cat:`sampled`,note:`click_a/b via uiClick()`,current:()=>o(),zz:[[`click`,w.uiClick]]},{name:`Confirm bloop`,cat:`synth`,note:`menu confirm, C5 -> G5 squares`,current:()=>d(),zz:[[`bloop`,w.confirmBloop]]},{name:`BIOS beep`,cat:`synth`,note:`POST beep, 940 Hz square`,current:()=>s(),zz:[[`beep`,w.biosBeep]]},{name:`BIOS tick`,cat:`synth`,note:`teletype tick per POST line`,current:()=>r(),zz:[[`tick`,w.biosTick]]},{name:`Scan blip`,cat:`synth`,note:`per-line entrance blip, random pitch`,current:()=>i(Math.random()),zz:[[`blip`,w.scanBlip]]},{name:`Entrance sweep`,cat:`synth`,note:`3-layer materialize sweep + thunk + ping (0.9 s)`,current:()=>f(.9),zz:[[`sweep`,w.entranceSweep]]},{name:`Prop sweep (small)`,cat:`synth`,note:`duck-sized prop materialize (0.9 s, quieter, no garnish)`,current:()=>c(.9),zz:null},{name:`Prop sweep (cabinet)`,cat:`synth`,note:`big prop: size-stretched 2.2 s, register dropped by the stretch`,current:()=>c(2.2),zz:null},{name:`Quack`,cat:`voice`,note:`reference only, chirp takes a-l round-robin`,current:()=>{let e=D[A.current++%12];a(h(`./assets/voices/duck1/chirp_${e}.wav`),{gain:.7})},zz:null}],F=[{name:`Ambient bed`,cat:`synth`,note:`arcade-room hum loop; ZzFX n/a (already synth)`,on:n,toggle:j},{name:`Roller rumble`,cat:`synth`,note:`rolling-noise loop at 0.7 speed; ZzFX n/a (already synth)`,on:v,toggle:M},{name:`Wheee`,cat:`voice`,note:`reference only, loop take a on the voice bus`,on:b,toggle:N}];return(0,S.jsxs)(`div`,{className:`sb-root`,children:[(0,S.jsx)(`style`,{children:k}),(0,S.jsxs)(`header`,{className:`sb-head`,children:[(0,S.jsx)(`h1`,{children:`Microduck Soundboard`}),(0,S.jsx)(`p`,{className:`sb-sub`,children:`A/B: current runtime implementation vs ZzFX candidate. First click unlocks audio.`}),(0,S.jsxs)(`label`,{className:`sb-vol`,children:[`Master volume`,(0,S.jsx)(`input`,{type:`range`,min:`0`,max:`1`,step:`0.01`,value:e,"aria-label":`Master volume`,onChange:e=>t(Number(e.target.value))}),(0,S.jsxs)(`span`,{children:[Math.round(e*100),`%`]})]})]}),(0,S.jsxs)(`div`,{className:`sb-grid`,role:`table`,"aria-label":`One-shot sounds`,children:[(0,S.jsxs)(`div`,{className:`sb-row sb-row-head`,role:`row`,children:[(0,S.jsx)(`span`,{children:`Sound`}),(0,S.jsx)(`span`,{children:`Category`}),(0,S.jsx)(`span`,{children:`Current`}),(0,S.jsx)(`span`,{children:`ZzFX candidate`})]}),P.map(e=>(0,S.jsxs)(`div`,{className:`sb-row`,role:`row`,children:[(0,S.jsxs)(`span`,{className:`sb-name`,children:[e.name,(0,S.jsx)(`small`,{children:e.note})]}),(0,S.jsx)(`span`,{children:(0,S.jsx)(`em`,{className:`sb-cat sb-cat-${e.cat}`,children:e.cat})}),(0,S.jsx)(`span`,{children:(0,S.jsx)(`button`,{type:`button`,className:`sb-btn sb-btn-cur`,onClick:()=>T(e.current),children:`Play`})}),(0,S.jsx)(`span`,{className:`sb-zz`,children:e.zz?e.zz.map(([e,t])=>(0,S.jsx)(`button`,{type:`button`,className:`sb-btn sb-btn-zz`,onClick:()=>T(()=>E(t)),children:e},e)):(0,S.jsx)(`em`,{className:`sb-na`,children:`n/a (voice reference)`})})]},e.name))]}),(0,S.jsx)(`h2`,{className:`sb-h2`,children:`Loops`}),(0,S.jsx)(`div`,{className:`sb-grid`,role:`table`,"aria-label":`Looping sounds`,children:F.map(e=>(0,S.jsxs)(`div`,{className:`sb-row`,role:`row`,children:[(0,S.jsxs)(`span`,{className:`sb-name`,children:[e.name,(0,S.jsx)(`small`,{children:e.note})]}),(0,S.jsx)(`span`,{children:(0,S.jsx)(`em`,{className:`sb-cat sb-cat-${e.cat}`,children:e.cat})}),(0,S.jsx)(`span`,{children:(0,S.jsx)(`button`,{type:`button`,className:`sb-btn sb-btn-cur ${e.on?`sb-on`:``}`,"aria-pressed":e.on,onClick:e.toggle,children:e.on?`Stop`:`Start`})}),(0,S.jsx)(`span`,{className:`sb-zz`,children:(0,S.jsx)(`em`,{className:`sb-na`,children:`n/a`})})]},e.name))})]})}var k=`
/* The game's index.html pins body { overflow: hidden } for the canvas;
   this page is a document, so re-enable normal scrolling. */
html, body { height: auto; overflow: auto; }
#root { height: auto; }
.sb-root {
  min-height: 100vh;
  background: #faf8f2;
  color: #101018;
  font: 15px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 2.2rem clamp(1rem, 5vw, 4rem) 4rem;
}
.sb-head h1 {
  font-family: 'Anton', 'Arial Narrow', Impact, sans-serif;
  font-size: clamp(2rem, 5vw, 3.2rem);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 0;
  color: #101018;
  -webkit-text-stroke: 1px #101018;
}
.sb-sub { margin: 0.3rem 0 1.2rem; opacity: 0.75; }
.sb-vol {
  display: inline-flex; align-items: center; gap: 0.7rem;
  border: 2px solid #101018; background: #fff;
  padding: 0.5rem 0.9rem; box-shadow: 4px 4px 0 #101018;
  margin-bottom: 1.6rem; font-weight: 700;
}
.sb-vol input { accent-color: #ff7a2f; width: 200px; }
.sb-h2 {
  font-family: 'Anton', 'Arial Narrow', Impact, sans-serif;
  text-transform: uppercase; margin: 2rem 0 0.6rem;
}
.sb-grid { border: 2px solid #101018; background: #fff; box-shadow: 6px 6px 0 #101018; }
.sb-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.6fr) 110px 130px minmax(160px, 1fr);
  align-items: center; gap: 0.8rem;
  padding: 0.55rem 0.9rem;
  border-bottom: 1px solid rgba(16, 16, 24, 0.18);
}
.sb-row:last-child { border-bottom: none; }
.sb-row-head {
  font-weight: 700; text-transform: uppercase; font-size: 12px;
  background: #101018; color: #faf8f2;
}
.sb-name { display: flex; flex-direction: column; font-weight: 700; }
.sb-name small { font-weight: 400; opacity: 0.6; font-size: 11px; }
.sb-cat {
  font-style: normal; font-size: 11px; font-weight: 700;
  text-transform: uppercase; padding: 2px 7px; border: 1.5px solid #101018;
}
.sb-cat-sampled { background: #ffe9db; }
.sb-cat-synth { background: #e5eeff; }
.sb-cat-voice { background: #fff3b0; }
.sb-btn {
  font: inherit; font-weight: 700; text-transform: uppercase; font-size: 12px;
  border: 2px solid #101018; padding: 0.35rem 0.9rem; cursor: pointer;
  box-shadow: 3px 3px 0 #101018; background: #faf8f2; color: #101018;
  margin: 2px 6px 2px 0;
}
.sb-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #101018; }
.sb-btn:focus-visible { outline: 3px solid #ff7a2f; outline-offset: 2px; }
.sb-btn-zz { background: #ff7a2f; color: #101018; }
.sb-btn-cur.sb-on { background: #101018; color: #faf8f2; }
.sb-na { opacity: 0.5; font-size: 12px; }
@media (max-width: 700px) {
  .sb-row { grid-template-columns: 1fr; gap: 0.3rem; }
  .sb-row-head { display: none; }
}
`;export{w as ZZFX_PRESETS,O as default};