/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { $$, expect } from '@salesforce/command/lib/test';

import { AuthInfo, ConfigAggregator, fs, Aliases, Org } from '@salesforce/core';
import { stubMethod } from '@salesforce/ts-sinon';
import { OrgListUtil } from '../../src/shared/orgListUtil';
import * as utils from '../../src/shared/utils';

const orgAuthConfigFields = {
  username: 'gaz@foo.org',
  expirationDate: '2099-03-30T00:00:00.000Z',
  devHubUsername: 'devhub@testOrg.com',
  accessToken: '123456abc',
  refreshToken: 'axb123',
  clientSecret: '123455',
};

const expiredAuthConfigFields = {
  username: 'test@foo.org',
  devHubUsername: 'devhub@testOrg.com',
  accessToken: '121abc',
  refreshToken: 'test123',
  clientSecret: '121',
};

const expiredAuthConfig = {
  getFields: () => expiredAuthConfigFields,
  getConnectionOptions: () => ({ accessToken: '00D!XX' }),
  isJwt: () => false,
  isOauth: () => false,
  getUsername: () => expiredAuthConfigFields.username,
};

const orgAuthConfig = {
  getFields: () => orgAuthConfigFields,
  getConnectionOptions: () => ({ accessToken: '00D!XX' }),
  isJwt: () => false,
  isOauth: () => false,
  getUsername: () => orgAuthConfigFields.username,
};

const devHubConfigFields = {
  username: 'foo@example.com',
  isDevHub: false, // we want to simulate updating this as part of the flow
};

const devHubConfig = {
  getFields: () => devHubConfigFields,
  getConnectionOptions: () => ({ accessToken: '00D!XX' }),
  isJwt: () => false,
  isOauth: () => false,
  getUsername: () => devHubConfigFields.username,
};
const fileNames = ['gaz@foo.org', 'test@org.com'];

describe('orgListUtil tests', () => {
  const spies = new Map();
  let aliasListStub: sinon.SinonStub;
  let determineConnectedStatusForNonScratchOrg: sinon.SinonStub;
  let retrieveScratchOrgInfoFromDevHubStub: sinon.SinonStub;
  let checkNonScratchOrgIsDevHub: sinon.SinonStub;

  describe('readLocallyValidatedMetaConfigsGroupedByOrgType', () => {
    afterEach(() => spies.clear());

    beforeEach(() => {
      $$.SANDBOX.stub(AuthInfo, 'create');

      stubMethod($$.SANDBOX, OrgListUtil, 'readAuthFiles').resolves([orgAuthConfig, expiredAuthConfig, devHubConfig]);
      aliasListStub = stubMethod($$.SANDBOX, Aliases, 'fetch').resolves();
      determineConnectedStatusForNonScratchOrg = stubMethod(
        $$.SANDBOX,
        OrgListUtil,
        'determineConnectedStatusForNonScratchOrg'
      ).resolves('Connected');
      retrieveScratchOrgInfoFromDevHubStub = stubMethod(
        $$.SANDBOX,
        OrgListUtil,
        'retrieveScratchOrgInfoFromDevHub'
      ).resolves([]);
      checkNonScratchOrgIsDevHub = stubMethod($$.SANDBOX, OrgListUtil, 'checkNonScratchOrgIsDevHub').resolves(true);

      spies.set('reduceScratchOrgInfo', $$.SANDBOX.spy(OrgListUtil, 'reduceScratchOrgInfo'));
      stubMethod($$.SANDBOX, ConfigAggregator, 'create').resolves({
        getConfig: () => {
          return {
            defaultusername: orgAuthConfigFields.username,
            defaultdevhubusername: devHubConfigFields.username,
          };
        },
      });

      $$.SANDBOX.stub(fs, 'readFileSync');
      stubMethod($$.SANDBOX, fs, 'stat').resolves({ atime: 'test' });

      $$.SANDBOX.stub(utils, 'getAliasByUsername').withArgs('gaz@foo.org').resolves('gaz');
    });

    afterEach(async () => {
      $$.SANDBOX.restore();
    });

    it('readLocallyValidatedMetaConfigsGroupedByOrgType', async () => {
      const flags = {};
      const orgs = await OrgListUtil.readLocallyValidatedMetaConfigsGroupedByOrgType(fileNames, flags);
      expect(orgs.nonScratchOrgs.every((nonScratchOrg) => nonScratchOrg.connectedStatus !== undefined)).to.be.true;
      expect(orgs.scratchOrgs.length).to.equal(2);
      expect(orgs.scratchOrgs[0]).to.haveOwnProperty('username').to.equal('gaz@foo.org');
      expect(orgs.nonScratchOrgs.length).to.equal(1);

      // devhub is updated to be true
      expect(checkNonScratchOrgIsDevHub.called).to.be.true;
      expect(orgs.nonScratchOrgs[0].isDevHub).to.be.true;

      expect(aliasListStub.calledOnce).to.be.false;
      expect(determineConnectedStatusForNonScratchOrg.calledOnce).to.be.true;
      expect(retrieveScratchOrgInfoFromDevHubStub.calledOnce).to.be.true;
    });

    it('skipconnectionstatus', async () => {
      const flags = { skipconnectionstatus: true };
      const orgs = await OrgListUtil.readLocallyValidatedMetaConfigsGroupedByOrgType(fileNames, flags);

      // we didn't check the status, so the hub is still not known to be a devhub
      expect(orgs.nonScratchOrgs[0].isDevHub).to.be.false;
      expect(checkNonScratchOrgIsDevHub.called).to.be.false;

      expect(orgs.nonScratchOrgs.every((nonScratchOrg) => nonScratchOrg.connectedStatus === undefined)).to.be.true;

      expect(aliasListStub.calledOnce).to.be.false;
      expect(aliasListStub.calledOnce).to.be.false;
      expect(determineConnectedStatusForNonScratchOrg.called).to.be.false;
    });

    it('should omit sensitive information and catergorise active and non-active scracth orgs', async () => {
      const flags = {};
      const orgs = await OrgListUtil.readLocallyValidatedMetaConfigsGroupedByOrgType(fileNames, flags);

      expect(orgs.scratchOrgs[0]).to.not.haveOwnProperty('clientSecret');
      expect(orgs.scratchOrgs[1]).to.not.haveOwnProperty('clientSecret');
      expect(orgs.scratchOrgs[0]).to.not.haveOwnProperty('refreshToken');
      expect(orgs.scratchOrgs[1]).to.not.haveOwnProperty('refreshToken');
    });

    it('should execute queries to check for org information if --verbose is used', async () => {
      const flags = { verbose: true };
      await OrgListUtil.readLocallyValidatedMetaConfigsGroupedByOrgType(fileNames, flags);
      expect(retrieveScratchOrgInfoFromDevHubStub.calledOnce).to.be.true;
      expect(spies.get('reduceScratchOrgInfo').calledOnce).to.be.true;
    });

    it('execute queries should add information to grouped orgs', async () => {
      retrieveScratchOrgInfoFromDevHubStub.restore();
      retrieveScratchOrgInfoFromDevHubStub = stubMethod(
        $$.SANDBOX,
        OrgListUtil,
        'retrieveScratchOrgInfoFromDevHub'
      ).resolves([
        {
          SignupUsername: 'gaz@foo.org',
          OrgName: 'Baz',
          CreatedDate: '2017-04-11T17:58:43.000+0000',
          CreatedBy: 'SRV',
          Edition: 'Developer',
          ScratchOrg: '00Dxx0000001hcF',
          Status: 'Active',
        },
      ]);
      const flags = { verbose: true };
      const orgGroups = await OrgListUtil.readLocallyValidatedMetaConfigsGroupedByOrgType(fileNames, flags);
      expect(retrieveScratchOrgInfoFromDevHubStub.calledOnce).to.be.true;
      expect(spies.get('reduceScratchOrgInfo').calledOnce).to.be.true;
      expect(orgGroups.scratchOrgs[0].signupUsername).to.equal(orgAuthConfigFields.username);
      expect(orgGroups.scratchOrgs[0]).to.include.keys([
        'signupUsername',
        'createdBy',
        'createdDate',
        'devHubOrgId',
        'orgName',
        'edition',
        'status',
        'expirationDate',
        'isExpired',
      ]);
    });

    it('handles connection errors for non-scratch orgs', async () => {
      determineConnectedStatusForNonScratchOrg.restore();
      stubMethod($$.SANDBOX, Org, 'create').returns(Org.prototype);
      stubMethod($$.SANDBOX, Org.prototype, 'getField').returns(undefined);
      stubMethod($$.SANDBOX, Org.prototype, 'getUsername').returns(devHubConfigFields.username);
      stubMethod($$.SANDBOX, Org.prototype, 'refreshAuth').rejects({ message: 'bad auth' });

      const orgGroups = await OrgListUtil.readLocallyValidatedMetaConfigsGroupedByOrgType(fileNames, {});
      expect(orgGroups.nonScratchOrgs).to.have.length(1);
      expect(orgGroups.nonScratchOrgs[0].connectedStatus).to.equal('bad auth');
      expect(checkNonScratchOrgIsDevHub.called).to.be.false;
    });

    it('handles auth file problems for non-scratch orgs', async () => {
      determineConnectedStatusForNonScratchOrg.restore();
      stubMethod($$.SANDBOX, Org, 'create').rejects({ message: 'bad file' });

      const orgGroups = await OrgListUtil.readLocallyValidatedMetaConfigsGroupedByOrgType(fileNames, {});
      expect(orgGroups.nonScratchOrgs).to.have.length(1);
      expect(orgGroups.nonScratchOrgs[0].connectedStatus).to.equal('bad file');
      expect(checkNonScratchOrgIsDevHub.called).to.be.false;
    });
  });

  describe('auth file reading tests', () => {
    // mock reading 2 org files
    beforeEach(() => {
      stubMethod($$.SANDBOX, fs, 'readdir').resolves(['00D000000000000001.json', '00D000000000000002.json']);
    });

    afterEach(async () => {
      $$.SANDBOX.restore();
    });

    it('will return an org with userId without an org file', async () => {
      stubMethod($$.SANDBOX, AuthInfo, 'create').resolves({
        getFields: () => ({ ...orgAuthConfigFields, userId: '005xxxxxxxxxxxxx', orgId: '00D000000000000003' }),
        getConnectionOptions: () => ({ accessToken: orgAuthConfigFields.accessToken }),
        isJwt: () => false,
        isOauth: () => false,
        getUsername: () => orgAuthConfigFields.username,
      });
      const authFiles = await OrgListUtil.readAuthFiles([`${orgAuthConfigFields.username}.json`]);
      expect(authFiles.length).to.equal(1);
      expect(authFiles[0].getFields()).to.have.property('username').equals(orgAuthConfigFields.username);
    });

    it('will return an org with userId with an org file where the userid is primary', async () => {
      stubMethod($$.SANDBOX, AuthInfo, 'create').resolves({
        getFields: () => ({ ...orgAuthConfigFields, userId: '005xxxxxxxxxxxxx', orgId: '00D000000000000001' }),
        getConnectionOptions: () => ({ accessToken: orgAuthConfigFields.accessToken }),
        isJwt: () => false,
        isOauth: () => false,
        getUsername: () => orgAuthConfigFields.username,
      });
      stubMethod($$.SANDBOX, fs, 'readJson').resolves({
        usernames: [orgAuthConfigFields.username, 'secondary@user.test'],
      });
      const authFiles = await OrgListUtil.readAuthFiles([`${orgAuthConfigFields.username}.json`]);
      expect(authFiles.length).to.equal(1);
      expect(authFiles[0].getFields()).to.have.property('username').equals(orgAuthConfigFields.username);
    });

    it('will NOT return an org with userId with an org file where the userid is NOT listed', async () => {
      stubMethod($$.SANDBOX, AuthInfo, 'create').resolves({
        getFields: () => ({ ...orgAuthConfigFields, userId: '005xxxxxxxxxxxxx', orgId: '00D000000000000001' }),
        getConnectionOptions: () => ({ accessToken: orgAuthConfigFields.accessToken }),
        isJwt: () => false,
        isOauth: () => false,
        getUsername: () => orgAuthConfigFields.username,
      });
      stubMethod($$.SANDBOX, fs, 'readJson').resolves({
        usernames: ['secondary@user.test'],
      });
      const authFiles = await OrgListUtil.readAuthFiles([`${orgAuthConfigFields.username}.json`]);
      expect(authFiles.length).to.equal(0);
    });

    it('will NOT return an org with userId with an org file where the userid is listed but not first', async () => {
      stubMethod($$.SANDBOX, AuthInfo, 'create').resolves({
        getFields: () => ({ ...orgAuthConfigFields, userId: '005xxxxxxxxxxxxx', orgId: '00D000000000000001' }),
        getConnectionOptions: () => ({ accessToken: orgAuthConfigFields.accessToken }),
        isJwt: () => false,
        isOauth: () => false,
        getUsername: () => orgAuthConfigFields.username,
      });
      stubMethod($$.SANDBOX, fs, 'readJson').resolves({
        usernames: ['secondary@user.test', orgAuthConfigFields.username],
      });
      const authFiles = await OrgListUtil.readAuthFiles([`${orgAuthConfigFields.username}.json`]);
      expect(authFiles.length).to.equal(0);
    });
  });
});
