import 'reflect-metadata';
import {DID, getKeyCurveByNameAndIndex, Mediator, Message, PeerDID, PrivateKey} from '../domain';
import {PrismDIDInfo} from '../domain/models/PrismDIDInfo';
import {VerifiableCredential} from '../domain/models/VerifiableCredential';
import {default as PlutoInterface} from '../domain/buildingBlocks/Pluto';
import {DataSource} from 'typeorm';
import * as entities from './entities';
import Did from './entities/DID';
import {DIDPair} from '../domain/models/DIDPair';
import {MysqlConnectionOptions} from 'typeorm/driver/mysql/MysqlConnectionOptions';
import {PostgresConnectionOptions} from 'typeorm/driver/postgres/PostgresConnectionOptions';
import {CockroachConnectionOptions} from 'typeorm/driver/cockroachdb/CockroachConnectionOptions';
import {SqliteConnectionOptions} from 'typeorm/driver/sqlite/SqliteConnectionOptions';
import {SqlServerConnectionOptions} from 'typeorm/driver/sqlserver/SqlServerConnectionOptions';
import {SapConnectionOptions} from 'typeorm/driver/sap/SapConnectionOptions';
import {OracleConnectionOptions} from 'typeorm/driver/oracle/OracleConnectionOptions';
import {CordovaConnectionOptions} from 'typeorm/driver/cordova/CordovaConnectionOptions';
import {NativescriptConnectionOptions} from 'typeorm/driver/nativescript/NativescriptConnectionOptions';
import {SqljsConnectionOptions} from 'typeorm/driver/sqljs/SqljsConnectionOptions';
import {MongoConnectionOptions} from 'typeorm/driver/mongodb/MongoConnectionOptions';
import {AuroraMysqlConnectionOptions} from 'typeorm/driver/aurora-mysql/AuroraMysqlConnectionOptions';
import {AuroraPostgresConnectionOptions} from 'typeorm/driver/aurora-postgres/AuroraPostgresConnectionOptions';
import {ExpoConnectionOptions} from 'typeorm/driver/expo/ExpoConnectionOptions';
import {BetterSqlite3ConnectionOptions} from 'typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions';
import {CapacitorConnectionOptions} from 'typeorm/driver/capacitor/CapacitorConnectionOptions';
import {SpannerConnectionOptions} from 'typeorm/driver/spanner/SpannerConnectionOptions';

type IgnoreProps = "entries" | "entityPrefix" | "metadataTableName";
export type PlutoConnectionProps =
    Omit<MysqlConnectionOptions, IgnoreProps>
    | Omit<PostgresConnectionOptions, IgnoreProps>
    | Omit<CockroachConnectionOptions, IgnoreProps>
    | Omit<SqliteConnectionOptions, IgnoreProps>
    | Omit<SqlServerConnectionOptions, IgnoreProps>
    | Omit<SapConnectionOptions, IgnoreProps>
    | Omit<OracleConnectionOptions, IgnoreProps>
    | Omit<CordovaConnectionOptions, IgnoreProps>
    | Omit<NativescriptConnectionOptions, IgnoreProps>
    | Omit<SqljsConnectionOptions, IgnoreProps>
    | Omit<MongoConnectionOptions, IgnoreProps>
    | Omit<AuroraMysqlConnectionOptions, IgnoreProps>
    | Omit<AuroraPostgresConnectionOptions, IgnoreProps>
    | Omit<ExpoConnectionOptions, IgnoreProps>
    | Omit<BetterSqlite3ConnectionOptions, IgnoreProps>
    | Omit<CapacitorConnectionOptions, IgnoreProps>
    | Omit<SpannerConnectionOptions, IgnoreProps>;

export default class Pluto implements PlutoInterface {
  dataSource: DataSource;

  constructor(connection: PlutoConnectionProps) {
    this.dataSource = new DataSource({
      ...connection,
      entities: Object.values(entities),
      synchronize: true
    });
  }

  private static transformMessageDBToInterface(item: entities.Message): Message {
    const jsonData = JSON.parse(item.dataJson);
    return {
      from: DID.fromString(item.from),
      to: DID.fromString(item.to),
      thid: item.thid,
      direction: item.isReceived,
      piuri: jsonData.piuri,
      id: item.id,
      expiresTimePlus: jsonData.expiresTimePlus,
      extraHeaders: jsonData.extraHeaders,
      createdTime: jsonData.createdTime,
      body: jsonData.body,
      ack: jsonData.ack,
      attachments: jsonData.attachments,
      fromPrior: jsonData.fromPrior,
      pthid: jsonData.pthid,
    };
  }

  async start() {
    try {
      await this.dataSource.initialize();
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async storePrismDID(did: DID, keyPathIndex: number, privateKey: PrivateKey, privateKeyMetaId: string | null, alias?: string) {
    const didEntity = new entities.DID();
    didEntity.did = did.toString();
    didEntity.method = did.method;
    didEntity.methodId = did.methodId;
    didEntity.schema = did.schema;
    didEntity.alias = alias ?? "";
    await this.dataSource.manager.save(didEntity);
    await this.storePrivateKeys(privateKey, did, keyPathIndex, privateKeyMetaId);
  }

  async storePeerDID(did: DID, privateKeys: PrivateKey[]) {
    const didEntity = new entities.DID();
    didEntity.did = did.toString();
    didEntity.method = did.method;
    didEntity.methodId = did.methodId;
    didEntity.schema = did.schema;
    didEntity.alias = null;
    await this.dataSource.manager.save(didEntity);
    await Promise.all(privateKeys.map((privateKey) => this.storePrivateKeys(privateKey, did, privateKey.keyCurve?.index ?? 0, null)));
  }

  async storeDIDPair(host: DID, receiver: DID, name: string) {
    const hostInfo = await this.getDIDInfoByDID(host);
    const receiverInfo = await this.getDIDInfoByDID(receiver);
    if (!hostInfo) {
      throw new Error("Your host DID is not stored, therefore can't store didPair");
    }
    if (!receiverInfo) {
      throw new Error("Your receiver DID is not stored, therefore can't store didPair");
    }
    const didPairEntity = new entities.DIDPair();
    didPairEntity.id = `${host.toString()}${receiver.toString()}`;
    didPairEntity.name = name;
    didPairEntity.hostDID = host.toString();
    didPairEntity.receiverDID = receiver.toString();

    await this.dataSource.manager.save(didPairEntity);
  }

  async storeMessage(message: Message) {
    const messageEntity = new entities.Message();
    messageEntity.createdTime = message.createdTime;
    messageEntity.dataJson = JSON.stringify(message);
    messageEntity.from = message.from?.toString() ?? "";
    messageEntity.thid = message.thid;
    messageEntity.to = message.to?.toString() ?? "";
    messageEntity.type = message.piuri ?? null;
    messageEntity.isReceived = message.direction;
    await this.dataSource.manager.save(messageEntity);
  }

  async storeMessages(messages: Message[]) {
    await Promise.all(messages.map(this.storeMessage.bind(this)));
  }

  async storePrivateKeys(privateKey: PrivateKey, did: DID, keyPathIndex: number, metaId: string | null) {
    const privateKeysEntity = new entities.PrivateKey();
    metaId && (privateKeysEntity.id = metaId); // question: Where should I store metaId
    privateKeysEntity.curve = privateKey.keyCurve.curve;
    privateKeysEntity.privateKey = privateKey.value.toString();
    privateKeysEntity.keyPathIndex = keyPathIndex ?? 0;
    privateKeysEntity.didId = did.toString();
    await this.dataSource.manager.save(privateKeysEntity);
  }

  async storeMediator(mediator: DID, host: DID, routing: DID) {

    const mediatorInfo = await this.getDIDInfoByDID(mediator);
    const hostInfo = await this.getDIDInfoByDID(host);
    const routingInfo = await this.getDIDInfoByDID(routing);

    if (!hostInfo) {
      throw new Error("Your host DID is not stored, therefore can't store didPair");
    }
    if (!mediatorInfo) {
      throw new Error("Your mediator DID is not stored, therefore can't store didPair");
    }
    if (!routingInfo) {
      throw new Error("Your routing DID is not stored, therefore can't store didPair");
    }
    const mediatorEntity = new entities.Mediator();
    mediatorEntity.mediatorDidId = mediator.toString();
    mediatorEntity.hostDidId = host.toString();
    mediatorEntity.routingDidId = routing.toString();
    await this.dataSource.manager.save(mediatorEntity);
  }

  async getAllPrismDIDs() {
    const didRepository = this.dataSource.manager.getRepository(entities.DID);
    try {
      const dids: (Did & Record<"keyPathIndex", number>)[] = await didRepository.createQueryBuilder('did')
          .innerJoin('PrivateKey', 'private_key', 'did.did = private_key.didId')
          .select('did.*, private_key.keyPathIndex')
          .where('did.method = :method', {method: "prism"})
          .getRawMany();
      return dids.map(item => ({
        did: DID.fromString(item.did),
        alias: item.alias,
        keyPathIndex: item.keyPathIndex
      })) as PrismDIDInfo[];
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getDIDInfoByDID(did: DID) {
    const didRepository = this.dataSource.manager.getRepository(entities.DID);
    try {
      const didResponse: (Did & Record<"keyPathIndex", number>) | undefined = await didRepository.createQueryBuilder('did')
          .innerJoin('private_key', 'private_key', 'did.did = private_key.didId')
          .select('did.*, privateKey.keyPathIndex', 'keyPathIndex')
          .from(subQuery => {
            return subQuery
                .select('pk.didId', 'didId')
                .addSelect('pk.keyPathIndex', 'keyPathIndex')
                .from('private_key', 'pk')
                .where('pk.didId = :didId', {didId: did.toString()});
          }, 'privateKey')
          .where('did.did = :didId', {didId: did.toString()})
          .getRawOne();
      if (!didResponse) {
        return null;
      }
      return {
        did: DID.fromString(didResponse?.did ?? ""),
        alias: didResponse.alias,
        keyPathIndex: didResponse.keyPathIndex
      } as PrismDIDInfo;
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getDIDInfoByAlias(alias: string) {
    const didRepository = this.dataSource.manager.getRepository(entities.DID);
    try {

      const didResponse: (Did & Record<"private_key_keyPathIndex", number>)[] = await didRepository.createQueryBuilder('did')
          .innerJoin('private_key', 'private_key', 'did.did = private_key.didId')
          .select(['did.*', 'private_key.keyPathIndex'])
          .where('did.alias = :alias', {alias})
          .getRawMany();
      if (!didResponse) {
        return [];
      }
      return didResponse.map(item => ({
        did: DID.fromString(item.did),
        alias: item.alias,
        keyPathIndex: item.private_key_keyPathIndex
      } as PrismDIDInfo));
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getPrismDIDKeyPathIndex(did: DID) {
    const repository = this.dataSource.manager.getRepository(entities.PrivateKey);
    try {
      const data = await repository.findOne({
        where: {
          didId: did.toString(),
        },
        select: {
          keyPathIndex: true
        }
      });
      return data?.keyPathIndex ?? null;
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getPrismLastKeyPathIndex() {
    const repository = this.dataSource.manager.getRepository(entities.PrivateKey);
    try {
      const data = await repository.createQueryBuilder('private_key')
          .select('private_key.keyPathIndex')
          .where(qb => {
            const subQuery = qb.subQuery()
                .select('did.did')
                .from(Did, 'did')
                .where('did.method = :method', {method: "prism"})
                .getQuery();
            return `private_key.didId IN ${subQuery}`;
          })
          .orderBy('private_key.keyPathIndex', 'DESC')
          .limit(1)
          .getOne();
      return data?.keyPathIndex ?? 0;
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getAllPeerDIDs() {
    const didRepository = this.dataSource.manager.getRepository(entities.DID);
    const privateKeysRepository = this.dataSource.manager.getRepository(entities.PrivateKey);
    /*
    * This method is overcomplicated, dids should have relations.
    * */
    try {
      const dids = await didRepository.find({
        where: {
          method: "peer"
        }
      });

      const didsWithKeys = await Promise.all(dids.map(async (item) => {
        return {
          ...item,
          privateKeys: await privateKeysRepository.find({
            where: {
              didId: item.did
            }
          })
        };
      }));

      return didsWithKeys.map(item => ({
        did: DID.fromString(item.did),
        privateKeys: item.privateKeys.map((key) => ({
          keyCurve: getKeyCurveByNameAndIndex(key.curve, key.keyPathIndex),
          value: Buffer.from(key.privateKey)
        }))
      })) as PeerDID[];
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getDIDPrivateKeysByDID(did: DID) {
    const repository = this.dataSource.manager.getRepository(entities.PrivateKey);
    try {
      const data = await repository.find({
        where: {
          didId: did.toString(),
        }
      });

      return data.map(item => ({
        keyCurve: getKeyCurveByNameAndIndex(item.curve),
        value: Buffer.from(item.privateKey)
      })) as PrivateKey[];

    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getDIDPrivateKeyByID(id: string) {
    const repository = this.dataSource.manager.getRepository(entities.PrivateKey);

    try {
      const data = await repository.findOne({
        where: {
          id
        }
      });
      if (!data) {
        return null;
      }
      return {
        keyCurve: getKeyCurveByNameAndIndex(data.curve),
        value: Buffer.from(data.privateKey)
      } as PrivateKey;
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getAllDidPairs() {
    const repository = this.dataSource.manager.getRepository(entities.DIDPair);
    try {
      const data = await repository.find({
        relationLoadStrategy: "join"
      });
      return data.map(didPair => ({
        host: DID.fromString(didPair.hostDID),
        name: didPair.name,
        receiver: DID.fromString(didPair.receiverDID)
      })) as DIDPair[];
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getPairByDID(did: DID) {

    const repository = this.dataSource.manager.getRepository(entities.DIDPair);
    try {
      const data = await repository.findOne({
        where: {
          hostDID: did.toString()
        },
        relationLoadStrategy: "join"
      });
      if (!data) {
        return null;
      }
      return {
        host: DID.fromString(data.hostDID),
        name: data.name,
        receiver: DID.fromString(data.receiverDID)
      } as DIDPair;
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getPairByName(name: string) {
    const repository = this.dataSource.manager.getRepository(entities.DIDPair);
    try {
      const data = await repository.findOne({
        where: {
          name: name
        },
        relationLoadStrategy: "join"
      });
      if (!data) {
        return null;
      }
      return {
        host: DID.fromString(data.hostDID),
        name: data.name,
        receiver: DID.fromString(data.receiverDID)
      } as DIDPair;
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async getAllMessages() {
    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.find();

    return data.map(Pluto.transformMessageDBToInterface);
  }

  async getAllMessagesByDID(did: DID) {

    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.find({
      where: {
        from: did.toString()
      }
    });

    return data.map(Pluto.transformMessageDBToInterface);
  }

  async getAllMessagesSent() {
    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.find({
      where: {
        isReceived: 0
      }
    });
    return data.map(Pluto.transformMessageDBToInterface);
  }

  async getAllMessagesReceived() {
    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.find({
      where: {
        isReceived: 1
      }
    });
    return data.map(Pluto.transformMessageDBToInterface);
  }

  async getAllMessagesSentTo(did: DID) {
    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.find({
      where: {
        to: did.toString()
      }
    });
    return data.map(Pluto.transformMessageDBToInterface);
  }

  async getAllMessagesReceivedFrom(did: DID) {
    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.find({
      where: {
        from: did.toString()
      }
    });
    return data.map(Pluto.transformMessageDBToInterface);
  }

  async getAllMessagesOfType(type: string, relatedWithDID?: DID) {
    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.createQueryBuilder('message')
        .where('message.type = :type', {type})
        .andWhere(':relatedWithDID IS NULL OR :relatedWithDID IN (message.from, message.to)', {relatedWithDID: relatedWithDID?.toString() ?? null})
        .getMany();

    return data.map(Pluto.transformMessageDBToInterface);
  }

  async getAllMessagesByFromToDID(from: DID, to: DID) {
    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.find({
      where: {
        from: from.toString(),
        to: to.toString()
      }
    });
    return data.map(Pluto.transformMessageDBToInterface);
  }

  async getMessage(id: string) {
    const repository = this.dataSource.manager.getRepository(entities.Message);
    const data = await repository.findOne({
      where: {
        id
      }
    });
    if (!data) {
      return null;
    }
    return Pluto.transformMessageDBToInterface(data);
  }

  async getAllMediators() {
    const repository = this.dataSource.manager.getRepository(entities.Mediator);
    const data = await repository.find({
      relationLoadStrategy: "join"
    });
    return data.map(item => ({
      id: item.id,
      mediatorDID: DID.fromString(item.mediatorDidId),
      hostDID: DID.fromString(item.hostDidId),
      routingDID: DID.fromString(item.routingDidId)
    })) as Mediator[];
  }

  async getAllCredentials() {
    const repository = this.dataSource.manager.getRepository(entities.VerifiableCredential);
    const data = await repository.find();
    return data.map(credential => {
      const json = JSON.parse(credential.verifiableCredentialJson) as VerifiableCredential;
      return {
        ...json,
        // override
        id: credential.id,
        issuer: DID.fromString(credential.issuerDIDId),
      };
    }) as VerifiableCredential[];
  }

  async storeCredential(credential: VerifiableCredential) {
    const verifiableCredentialEntity = new entities.VerifiableCredential();
    verifiableCredentialEntity.credentialType = credential.credentialType;
    verifiableCredentialEntity.expirationDate = credential.expirationDate;
    verifiableCredentialEntity.issuanceDate = credential.issuanceDate;
    verifiableCredentialEntity.verifiableCredentialJson = JSON.stringify(credential);
    verifiableCredentialEntity.issuerDIDId = credential.issuer.toString();
    await this.dataSource.manager.save(verifiableCredentialEntity);
  }
}