import {
  Curve,
  DID,
  Seed,
  Service,
  ServiceEndpoint,
  Signature,
} from "../domain";
import { Apollo } from "../domain/buildingBlocks/Apollo";
import { Castor } from "../domain/buildingBlocks/Castor";
import { Pluto } from "../domain/buildingBlocks/Pluto";
import { AgentError } from "../domain/models/Errors";
import {
  AgentDIDHigherFunctions as AgentDIDHigherFunctionsClass,
  ConnectionsManager,
  MediatorHandler,
} from "./types";

/**
 * An extension for the Edge agent that groups some DID related operations mainly used to expose the create did functionality
 *
 * @export
 * @class AgentDIDHigherFunctions
 * @typedef {AgentDIDHigherFunctions}
 */
export class AgentDIDHigherFunctions implements AgentDIDHigherFunctionsClass {
  /**
   * Creates an instance of AgentDIDHigherFunctions.
   *
   * @constructor
   * @param {Apollo} apollo
   * @param {Castor} castor
   * @param {Pluto} pluto
   * @param {ConnectionsManager} manager
   * @param {MediatorHandler} mediationHandler
   * @param {Seed} seed
   */
  constructor(
    protected apollo: Apollo,
    protected castor: Castor,
    protected pluto: Pluto,
    protected manager: ConnectionsManager,
    protected mediationHandler: MediatorHandler,
    protected seed: Seed
  ) {}

  /**
   * Asyncronously sign with a DID
   *
   * @async
   * @param {DID} did
   * @param {Uint8Array} message
   * @returns {Promise<Signature>}
   */
  async signWith(did: DID, message: Uint8Array): Promise<Signature> {
    const privateKeys = await this.pluto.getDIDPrivateKeysByDID(did);
    const privateKey = privateKeys.at(0);

    if (privateKey === undefined) {
      throw new AgentError.CannotFindDIDPrivateKey();
    }

    return this.apollo.signByteArrayMessage(privateKey, message);
  }

  /**
   * Asyncronously create and store a new peer did
   *
   * @async
   * @param {Service[]} services
   * @param {boolean} [updateMediator=false]
   * @returns {Promise<DID>}
   */
  async createNewPeerDID(
    services: Service[],
    updateMediator = false
  ): Promise<DID> {
    const index = await this.pluto.getPrismLastKeyPathIndex();
    const keyAgreementKeyPair = this.apollo.createKeyPairFromKeyCurve(
      {
        curve: Curve.X25519,
        index: index,
      },
      this.seed
    );
    const authenticationKeyPair = this.apollo.createKeyPairFromKeyCurve(
      {
        curve: Curve.ED25519,
        index: index,
      },
      this.seed
    );
    const mediatorDID = this.manager.mediationHandler.mediator?.routingDID;
    const keyPairs = [keyAgreementKeyPair, authenticationKeyPair];

    if (
      updateMediator &&
      mediatorDID &&
      !services.find((service) => {
        return service.isDIDCommMessaging;
      })
    ) {
      //TODO(): This still needs to be done update the key List
      services.push(
        new Service(
          "#didcomm-1",
          ["DIDCommMessaging"],
          new ServiceEndpoint(mediatorDID.toString())
        )
      );
    }

    const did = await this.castor.createPeerDID(keyPairs, services);

    if (updateMediator) {
      await this.mediationHandler.updateKeyListWithDIDs([did]);
    }

    this.pluto.storePeerDID(did, [
      keyAgreementKeyPair.privateKey,
      authenticationKeyPair.privateKey,
    ]);

    return did;
  }

  /**
   * Asyncronously create and store a PrismDID
   *
   * @async
   * @param {string} alias
   * @param {Service[]} services
   * @param {?number} [keyPathIndex]
   * @returns {Promise<DID>}
   */
  async createNewPrismDID(
    alias: string,
    services: Service[],
    keyPathIndex?: number
  ): Promise<DID> {
    const index = keyPathIndex
      ? keyPathIndex
      : await this.pluto.getPrismLastKeyPathIndex();
    const keyPair = this.apollo.createKeyPairFromKeyCurve(
      {
        curve: Curve.SECP256K1,
        index: index,
      },
      this.seed
    );
    const did = await this.castor.createPrismDID(keyPair.publicKey, services);
    await this.pluto.storePrismDID(did, index, keyPair.privateKey, null, alias);
    return did;
  }
}
