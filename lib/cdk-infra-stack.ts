import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as autoscaling from'@aws-cdk/aws-autoscaling'

export class CdkInfraStack extends cdk.Stack {

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // cdk deploy 하기 전에!
    // packer로 첫 번째 ami 만들어두기


    // vpc 생성
    const vpc = new ec2.Vpc(this, 'lan-cicd-vpc', {
      cidr: '172.20.0.0/16',
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'lan-cicd-public',
          subnetType: ec2.SubnetType.PUBLIC,  // 나중에 private으로
        }
      ],
    })
    
    //---------------------------------------------------------------------------------------------
    // alb 생성하기
    const lanCicdLbSg = new ec2.SecurityGroup(this, 'lan-cicd-alb-sg', {
      vpc,
      description: 'lan-cicd-alb-sg',
      securityGroupName: 'lan-cicd-alb-sg'      
    });
    lanCicdLbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH Access')
    lanCicdLbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow TCP Access')

    const alb = new elbv2.ApplicationLoadBalancer(this, 'lan-cicd-alb', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      },
      internetFacing: true,
      loadBalancerName: "lan-cicd-alb",
      securityGroup: lanCicdLbSg      
    });
    cdk.Tags.of(alb).add("name", "lan-cicd-alb");   // target group 과 동일한 name을 갖게 됨 > sdk에서 arn 검색을 위해 태그 조정 필요
        
    //---------------------------------------------------------------------------------------------
    // asg 보안그룹 만들기
    const lanCicdAsgSg = new ec2.SecurityGroup(this, 'lan-cicd-asg-sg', {
      vpc,
      description: 'lan-cicd-asg-sg',
      securityGroupName: 'lan-cicd-asg-sg'
    });
    lanCicdAsgSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH Access')
    lanCicdAsgSg.addIngressRule(lanCicdAsgSg, ec2.Port.tcp(8080), 'Allow tcp from ALB')

    // asg 첫 번째 ami 가져오기
    const firstAmi = new ec2.LookupMachineImage({
      name: 'lan-cicd-ami',

    })

    // lc 필요 없음. asg 옵션에 넣어서 만들면 됨
    const firstASG = new autoscaling.AutoScalingGroup(this, 'lan-cicd-first-asg', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
      machineImage: firstAmi,
      securityGroup: lanCicdAsgSg,
      autoScalingGroupName: 'lan-cicd-first-asg',
      desiredCapacity: 1,
      maxCapacity: 3,
      minCapacity: 1,
      groupMetrics: [autoscaling.GroupMetrics.all()],
      keyName: 'lanKeyPair'
    });
    firstASG.scaleOnCpuUtilization('KeepSpareCPU', {
      targetUtilizationPercent: 50
    });

    //---------------------------------------------------------------------------------------------
    // alb 리스너 추가
    const albListener = alb.addListener('lan-cicd-first-listener', {
      port: 80,
      open: true,  
    });    

    // alb 타겟그룹 추가
    albListener.addTargets('lan-cicd-first-target-group', { 
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      protocolVersion: elbv2.ApplicationProtocolVersion.HTTP1,
      targets: [firstASG]
    });





    
  } // constructor

  // ---------------------------------------------------------------------------------
  // az 지정
  get availabilityZones(): string[] {
    return ['ap-northeast-2a', 'ap-northeast-2c']; 
  }


}