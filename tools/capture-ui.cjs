const {chromium}=require('playwright');
const sharp=require('sharp');
const path=require('path');
const fs=require('fs');
(async()=>{
 const root=path.resolve(__dirname,'..');
 fs.mkdirSync(path.join(root,'docs/screenshots'),{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const [platform,width,height] of [['android',412,892],['windows',1130,780]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+root+'/ui/index.html?platform='+platform);
  if(platform==='android') await page.locator('#textInput').fill('const message = "Сәлем, бро!";\nconsole.log(message);');
  await page.screenshot({path:root+'/docs/screenshots/'+platform+'.png'});
  await page.locator('.nav[data-tab="connection"]').click();
  if(!await page.locator('#connection').isVisible())throw Error('Connection navigation');
  await page.locator('.nav[data-tab="history"]').click();
  if(!await page.locator('#history').isVisible())throw Error('History navigation');
  await page.locator('.nav[data-tab="clipboard"]').click();
  if(platform==='android'){
   await page.getByRole('tab',{name:'Сурет',exact:true}).click();
   if(!await page.locator('#imagePanel').isVisible())throw Error('Image tab');
   await page.getByRole('tab',{name:'Мәтін / код',exact:true}).click();
   await page.locator('#sendButton').click();
   if(!await page.locator('#connection').isVisible())throw Error('Disconnected send must open pairing');
   await page.setViewportSize({width:320,height:760});
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
  }
  if(errors.length)throw Error(errors.join('\n'));
  console.log(platform+': UI loaded, navigation and state checks passed');
  await page.close();
 }
 await browser.close();
 const desktop=await sharp(root+'/docs/screenshots/windows.png').resize({width:980}).png().toBuffer();
 const mobile=await sharp(root+'/docs/screenshots/android.png').resize({height:720}).png().toBuffer();
 await sharp({create:{width:1380,height:800,channels:4,background:'#edf1f7'}}).composite([{input:desktop,left:22,top:62},{input:mobile,left:1025,top:40}]).png().toFile(root+'/docs/screenshots/bailanys.png');
})().catch(e=>{console.error(e);process.exit(1)});
