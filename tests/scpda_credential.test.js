'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validScpdaCredential}=require('../apps/admin-api/src/services/scpdaCredential');
test('existing reader PINs and exact alphanumeric passwords remain usable',()=>{
 for(const value of ['0000','4567','qaRead7','QaRead7!','a'.repeat(64)])assert.equal(validScpdaCredential(value),true);
 for(const value of [null,1234,'','123','12345','qaRead7 ',' qaRead7','qa\nRead7','qaRead7\n','4567\n','ทดสอบ123','a'.repeat(65)])assert.equal(validScpdaCredential(value),false);
});
