import { defaultParams } from '../src/params';
import { runChecks } from '../src/analysis';
const p:any={...defaultParams(),kingpinDiameterIn:0.875,axleDiameterIn:0.875,kingpinLeadIn:1.3125,frontAxleBeamThicknessIn:3.75,deckPlyIn:.472,crossmemberSpacingIn:6};
for (const c of runChecks(p,{includeTruck:false})) if (/kingpin|roll|axle|bearing|turntable/.test(c.id)) console.log(c.id,c.statusOperating,c.statusGoal,c.value,c.limit,'\n  ',c.how.slice(0,900));
