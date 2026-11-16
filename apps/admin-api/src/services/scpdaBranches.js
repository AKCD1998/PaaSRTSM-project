'use strict';
const OPERATOR_BRANCHES=Object.freeze({'01001':'001','02001':'001','03001':'001','01005':'005'});
const BRANCH_COLUMNS=Object.freeze({'001':'qty_branch_001','005':'qty_branch_005'});
const operatorBranch=code=>OPERATOR_BRANCHES[code]||null;
const branchEnabled=(config,branch)=>branch==='001'||branch==='005'&&config.featureScpdaBranch005===true;
const readContract=branch=>'scpda-read-'+branch+'-v1';
const countContract=branch=>'scpda-counts-'+branch+'-v1';
function stockColumn(branch){if(!Object.hasOwn(BRANCH_COLUMNS,branch))throw Error('Unsupported SCPDA branch');return BRANCH_COLUMNS[branch];}
module.exports={OPERATOR_BRANCHES,operatorBranch,branchEnabled,readContract,countContract,stockColumn};
