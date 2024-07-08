import * as cdk from "aws-cdk-lib";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import {
  CloudFrontWebDistribution,
  OriginAccessIdentity,
  PriceClass,
  ViewerCertificate,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { CanonicalUserPrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  ARecord,
  HostedZone,
  IHostedZone,
  RecordTarget,
} from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import path = require("path");
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext("config");
    if (!environment) {
      throw new Error(
        "Environment variable must be passed to cdk: ` cdk -c config=XXX`"
      );
    }

    const config: Config = this.node.getContext(environment);

    const domainName = config.domainName;

    const zone = this.getHostedZone(domainName);

    const certificate = this.createCertificate(domainName, zone);

    const originAccessIdentity = this.createOriginAccessIdentity();

    const bucket = this.createBucket(config.bucketName, originAccessIdentity);

    const distribution = this.createDistribution({
      bucket,
      certificate,
      domainName,
      originAccessIdentity,
    });

    this.createBucketDeployment(bucket, distribution);

    this.createAliasRecord(distribution, zone);
  }

  createAliasRecord(
    distribution: CloudFrontWebDistribution,
    zone: IHostedZone
  ): ARecord {
    return new ARecord(this, "alias", {
      zone,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });
  }

  createBucket(
    bucketName: string,
    originAccessIdentity: OriginAccessIdentity
  ): Bucket {
    const bucket = new Bucket(this, "bucket", {
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: BucketEncryption.S3_MANAGED,
      bucketName,
    });

    bucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:*"],
        resources: [bucket.arnForObjects("*")],
        principals: [
          new CanonicalUserPrincipal(
            originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId
          ),
        ],
      })
    );

    return bucket;
  }

  createBucketDeployment(
    bucket: Bucket,
    distribution: CloudFrontWebDistribution
  ): BucketDeployment {
    return new BucketDeployment(this, "bucketDeployment", {
      sources: [
        Source.asset(path.join(__dirname, "..", "angular/dist/angular/")),
      ],

      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
    });
  }

  createCertificate(domainName: string, zone: IHostedZone): Certificate {
    return new Certificate(this, "certificate", {
      domainName: domainName,
      validation: CertificateValidation.fromDns(zone),
    });
  }

  createDistribution(props: {
    bucket: Bucket;
    certificate: Certificate;
    domainName: string;
    originAccessIdentity: OriginAccessIdentity;
  }): CloudFrontWebDistribution {
    return new CloudFrontWebDistribution(this, "distribution", {
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: props.bucket,
            originAccessIdentity: props.originAccessIdentity,
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
          ],
        },
      ],
      errorConfigurations: [
        {
          errorCode: 400,
          responseCode: 200,
          responsePagePath: "/index.html",
        },
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: "/index.html",
        },
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: "/index.html",
        },
      ],
      defaultRootObject: "index.html",
      priceClass: PriceClass.PRICE_CLASS_100,
      viewerCertificate: ViewerCertificate.fromAcmCertificate(
        props.certificate,
        {
          aliases: [props.domainName],
        }
      ),
    });
  }

  createOriginAccessIdentity(): OriginAccessIdentity {
    return new OriginAccessIdentity(this, "OriginAccessIdentity");
  }

  getHostedZone(domainName: string): IHostedZone {
    return HostedZone.fromLookup(this, "hostedZone", {
      domainName,
    });
  }
}

export type Config = {
  bucketName: string;
  domainName: string;
};
