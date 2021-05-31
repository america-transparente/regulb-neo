import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import * as cloudflare from "@pulumi/cloudflare";
// import * as ts from "typesense";

// Deploys all the needed infrastructure for the backend of reguleque.cl
// This includes all AWS resources and Cloudflare records
// Config values needed: domain, subdomain, cloudflareZoneId, adminApiKey (secret)

export = async () => {
    const config = new pulumi.Config();

    // Main VPC
    const vpc = new awsx.ec2.Vpc("reguleque-vpc", {
        enableDnsHostnames: true,
        enableDnsSupport: true,
    });
    const vpcPublicSubnetIds = await vpc.publicSubnetIds;

    // Internal SG
    const sg = new awsx.ec2.SecurityGroup("reguleque-sg", { vpc });

    
    // Outbound TCP traffic on any port to anywhere
    sg.createEgressRule("outbound-access", {
        location: new awsx.ec2.AnyIPv4Location(),
        ports: new awsx.ec2.AllTcpPorts(),
        description: "allow outbound access to anywhere",
    });

    // Fargate-EFS communication
    sg.createIngressRule("efs-mount", {
        location: new awsx.ec2.AnyIPv4Location(),
        ports: new awsx.ec2.TcpPorts(2049),
        description: "allow EFS volume communication",
    })

    // Create a load balancer with a custom Target Group using the /health endpoint for health checks to Typesense (this automates healing on the load balancer).
    const lb = new awsx.lb.ApplicationLoadBalancer("typesense-lb", {
        vpc: vpc,
        securityGroups: [sg]
    });
    const tg = lb.createTargetGroup("typesense-tg", {
        port: 80,
        protocol: "HTTP",
        healthCheck: {
            protocol: "HTTP",
            path: "/health"
        }
    })
    // Add the listener, this routes the requests to the containers we're going to create.
    const lbl = tg.createListener("typesense-lb", {
        protocol: "HTTP"
    });

    // Create a cluster for the containers
    const cluster = new awsx.ecs.Cluster("reguleque-cl", {
        vpc,
        securityGroups: [sg],
    });


    // Define the cluster task and service, building and publishing our "./app/Dockerfile" and connecting to the listener.
    const adminApiKey = config.require("adminApiKey");


    // Create a EFS volume for persistence
    const filesystem = new aws.efs.FileSystem("typesense-fs", {
        tags: {
            Name: "typesense-fs"
        },
        lifecyclePolicy: {
            transitionToIa: "AFTER_7_DAYS"
        },
    });

    // Create mount point targets on every availability zone
    const targets = [];
    for (let i = 0; i < vpcPublicSubnetIds.length; i++) {
        targets.push(new aws.efs.MountTarget(`typesense-fs-mount-${i}`, {
            fileSystemId: filesystem.id,
            subnetId: vpcPublicSubnetIds[i],
            securityGroups: [sg.id],
        }));
    }

    // Create an Access Point to our volume
    const ap = new aws.efs.AccessPoint("typesense-fs-as", {
        fileSystemId: filesystem.id,
    }, { dependsOn: targets })

    // Create the EFS Configuration for connecting to Fargate
    const efsVolumeConfiguration: aws.types.input.ecs.TaskDefinitionVolumeEfsVolumeConfiguration = {
        fileSystemId: filesystem.id,
        authorizationConfig: { accessPointId: ap.id, },
        transitEncryption: "ENABLED",
    };

    const typesenseTask = new awsx.ecs.FargateTaskDefinition
        ("typesense-ta", {
            containers: {
                typesense: {
                    // Build the image from the Dockerfile
                    image: awsx.ecs.Image.fromPath("typesense", "./app"),
                    // This container is a requisite for the entire task
                    essential: true,
                    // Pass the administrator API key secret from the config
                    environment: [{
                        "name": "TYPESENSE_API_KEY",
                        "value": adminApiKey,
                    }],
                    // Requirements
                    cpu: 2,
                    memory: 512,
                    // Connect with the load balancer listener
                    portMappings: [lbl],
                    // Mount a persistent volume for the typesense database
                    mountPoints: [
                        {
                            sourceVolume: "typesense-storage",
                            containerPath: "/data"
                        }
                    ]
                },
            },
            // Link the volume needed for /data
            // Note that sharing this between typesense instances has NOT been tested
            volumes: [
                {
                    name: "typesense-storage",
                    efsVolumeConfiguration
                }
            ]
        })
    // Create the service with only one instance in the cluster
    // Scaling has NOT been tested yet.
    const typesenseService = typesenseTask.createService("typesense-se", {
        cluster,
        securityGroups: [sg, ...cluster.securityGroups],
        subnets: vpc.publicSubnetIds,
        desiredCount: 1,
    });

    const endpointDomain = config.require("domain");
    const endpointSubdomain = config.require("subdomain");

    // Configure the CNAME to the endpoint in Cloudflare
    const record = new cloudflare.Record("api-record", {
        zoneId: config.require("cloudflareZoneId"),
        type: "CNAME",
        name: endpointSubdomain,
        value: lbl.endpoint.hostname,
        proxied: true
    });

    const internalEndpoint = pulumi.interpolate`http://${lbl.endpoint.hostname}/`;
    const externalEndpoint = pulumi.interpolate`https://${endpointSubdomain}.${endpointDomain}/`;


    return {
        internalEndpoint,
        externalEndpoint
    }
}
